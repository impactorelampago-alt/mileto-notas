-- ============================================================================
-- Mileto Notas — categorias de programa + histórico de subnotas concluídas
-- Data: 2026-08-25
--
-- CONTRATO:
--   - a nota raiz de uma categoria de programa é o agrupador/responsável;
--   - somente subnotas podem ser concluídas e enviadas ao histórico;
--   - o responsável da entrega é o assignee da task raiz (fallback: criador);
--   - quem conclui é registrado separadamente para os indicadores de programação;
--   - DONO/GERENTE/COORDENADOR veem indicadores da equipe;
--   - cargo Programador vê o histórico, mas a RPC de métricas retorna só seus dados;
--   - o histórico sobrevive a exclusões posteriores de notas/categorias.
--
-- Esta migration toca o banco COMPARTILHADO com o Mileto Ops. Aplicar somente
-- depois de revisar o schema do Ops e atualizar seu espelho Drizzle/documentação.
-- ============================================================================

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

DO $guard$
BEGIN
  IF to_regclass('public.notes') IS NULL
     OR to_regclass('public.tasks') IS NULL
     OR to_regclass('public.custom_statuses') IS NULL
     OR to_regclass('public.profiles') IS NULL
     OR to_regclass('public.permission_settings') IS NULL THEN
    RAISE EXCEPTION 'Pré-requisitos do histórico de programas não encontrados';
  END IF;

  IF to_regprocedure('public.current_account_id()') IS NULL
     OR to_regprocedure('public.user_can_edit_note(uuid)') IS NULL
     OR to_regprocedure('public.notas_owns_category_key(text)') IS NULL THEN
    RAISE EXCEPTION 'Helpers de conta/permissão do Mileto Notas não encontrados';
  END IF;
END
$guard$;

CREATE TABLE IF NOT EXISTS public.notas_programs (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id    uuid NOT NULL DEFAULT public.current_account_id()
                  REFERENCES public.accounts(id) ON DELETE CASCADE,
  category_key  text NOT NULL,
  name          text NOT NULL,
  color         text NOT NULL DEFAULT '#10b981',
  active        boolean NOT NULL DEFAULT true,
  created_by    uuid REFERENCES public.profiles(id) ON DELETE SET NULL
                  DEFAULT auth.uid(),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT notas_programs_name_nonempty CHECK (btrim(name) <> ''),
  CONSTRAINT notas_programs_account_category_unique UNIQUE (account_id, category_key)
);

CREATE INDEX IF NOT EXISTS idx_notas_programs_account_active
  ON public.notas_programs (account_id, active, name, id);

CREATE TABLE IF NOT EXISTS public.notas_program_history (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id               uuid NOT NULL
                             REFERENCES public.accounts(id) ON DELETE CASCADE,
  program_id               uuid NOT NULL
                             REFERENCES public.notas_programs(id) ON DELETE RESTRICT,
  note_id                  uuid REFERENCES public.notes(id) ON DELETE SET NULL,
  root_note_id             uuid REFERENCES public.notes(id) ON DELETE SET NULL,
  category_key_snapshot    text NOT NULL,
  program_name_snapshot    text NOT NULL,
  root_title_snapshot      text NOT NULL DEFAULT '',
  title_snapshot           text NOT NULL DEFAULT '',
  content_snapshot         text NOT NULL DEFAULT '',
  priority_snapshot        text,
  reporter_id              uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  reporter_name_snapshot   text NOT NULL DEFAULT '',
  completed_by             uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  completed_by_name_snapshot text NOT NULL DEFAULT '',
  source_created_at        timestamptz,
  completed_at             timestamptz NOT NULL DEFAULT now(),
  reopened_at              timestamptz,
  reopened_by              uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at               timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT notas_program_history_reopen_pair CHECK (
    (reopened_at IS NULL AND reopened_by IS NULL)
    OR reopened_at IS NOT NULL
  )
);

CREATE INDEX IF NOT EXISTS idx_notas_program_history_program_completed
  ON public.notas_program_history (account_id, program_id, completed_at DESC, id);

CREATE INDEX IF NOT EXISTS idx_notas_program_history_reporter
  ON public.notas_program_history (account_id, program_id, reporter_id, completed_at DESC);

CREATE INDEX IF NOT EXISTS idx_notas_program_history_completed_by
  ON public.notas_program_history (account_id, program_id, completed_by, completed_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS uq_notas_program_history_active_note
  ON public.notas_program_history (note_id)
  WHERE note_id IS NOT NULL AND reopened_at IS NULL;

ALTER TABLE public.notas_programs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notas_program_history ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS notas_programs_select_account ON public.notas_programs;
CREATE POLICY notas_programs_select_account
  ON public.notas_programs
  FOR SELECT
  TO authenticated
  USING (account_id = public.current_account_id());

-- O histórico é lido exclusivamente pelas RPCs abaixo. Isso impede que um
-- Programador contorne a regra das métricas individuais consultando agregados
-- diretamente na tabela.
REVOKE ALL ON TABLE public.notas_programs FROM PUBLIC, anon;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.notas_programs FROM authenticated;
GRANT SELECT ON TABLE public.notas_programs TO authenticated;

REVOKE ALL ON TABLE public.notas_program_history FROM PUBLIC, anon, authenticated;

-- Chaves dos nós cujo nome/label/key representa o cargo Programador. O fallback
-- pelo próprio key cobre configurações antigas sem label persistido na árvore.
CREATE OR REPLACE FUNCTION public.notas_programmer_cargo_keys(p_nodes jsonb)
RETURNS text[]
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_node jsonb;
  v_keys text[] := '{}';
  v_label text;
BEGIN
  IF p_nodes IS NULL OR jsonb_typeof(p_nodes) <> 'array' THEN
    RETURN v_keys;
  END IF;

  FOR v_node IN SELECT value FROM jsonb_array_elements(p_nodes)
  LOOP
    v_label := regexp_replace(
      upper(coalesce(
        v_node->>'label',
        v_node->>'name',
        v_node->>'title',
        v_node->>'key',
        ''
      )),
      '[^A-Z0-9]+',
      '',
      'g'
    );

    IF v_label = 'PROGRAMADOR' AND nullif(v_node->>'key', '') IS NOT NULL THEN
      v_keys := array_append(v_keys, v_node->>'key');
    END IF;

    v_keys := v_keys || public.notas_programmer_cargo_keys(v_node->'children');
  END LOOP;

  RETURN v_keys;
END
$fn$;

CREATE OR REPLACE FUNCTION public.notas_program_access_level()
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_uid uuid := auth.uid();
  v_role text;
  v_account uuid;
  v_is_programmer boolean := false;
BEGIN
  IF v_uid IS NULL THEN
    RETURN 'NONE';
  END IF;

  SELECT profile.role::text, profile.account_id
    INTO v_role, v_account
    FROM public.profiles AS profile
   WHERE profile.id = v_uid;

  IF v_account IS NULL THEN
    RETURN 'NONE';
  END IF;

  IF v_role IN ('DONO', 'GERENTE', 'COORDENADOR') THEN
    RETURN 'TEAM';
  END IF;

  SELECT EXISTS (
    SELECT 1
      FROM public.permission_settings AS settings
      CROSS JOIN LATERAL jsonb_each(
        coalesce(settings.cargo_members, '{}'::jsonb)
      ) AS cargo(cargo_key, members)
     WHERE (
       NOT (to_jsonb(settings) ? 'account_id')
       OR to_jsonb(settings)->>'account_id' = v_account::text
     )
       AND jsonb_typeof(cargo.members) = 'array'
       AND cargo.members ? v_uid::text
       AND (
         regexp_replace(upper(cargo.cargo_key), '[^A-Z0-9]+', '', 'g') = 'PROGRAMADOR'
         OR cargo.cargo_key = ANY (
           public.notas_programmer_cargo_keys(settings.nucleo_tree)
         )
       )
  ) INTO v_is_programmer;

  RETURN CASE WHEN v_is_programmer THEN 'SELF' ELSE 'NONE' END;
END
$fn$;

REVOKE ALL ON FUNCTION public.notas_programmer_cargo_keys(jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.notas_program_access_level() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.notas_program_access_level() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.notas_set_category_program(
  p_category_key text,
  p_is_program boolean
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_uid uuid := auth.uid();
  v_account uuid := public.current_account_id();
  v_status record;
  v_program_id uuid;
BEGIN
  IF public.notas_program_access_level() = 'NONE' THEN
    RAISE EXCEPTION 'sem permissão para configurar categorias de programa';
  END IF;

  SELECT status.key, status.label, status.color, status.account_id
    INTO v_status
    FROM public.custom_statuses AS status
   WHERE status.key = p_category_key;

  IF NOT FOUND OR v_status.account_id IS DISTINCT FROM v_account THEN
    RAISE EXCEPTION 'categoria inexistente ou fora da conta atual';
  END IF;

  IF NOT public.notas_owns_category_key(p_category_key) THEN
    RAISE EXCEPTION 'somente o dono da categoria pode alterar seu tipo';
  END IF;

  IF p_category_key ~ '_(TODO|IN_PROGRESS|IN_REVIEW|DONE|CANCELLED)$' THEN
    RAISE EXCEPTION 'categorias de sistema não podem ser programas';
  END IF;

  IF p_is_program THEN
    INSERT INTO public.notas_programs AS program
      (account_id, category_key, name, color, active, created_by, updated_at)
    VALUES
      (v_account, p_category_key, v_status.label, coalesce(v_status.color, '#10b981'), true, v_uid, now())
    ON CONFLICT (account_id, category_key)
    DO UPDATE SET
      name = EXCLUDED.name,
      color = EXCLUDED.color,
      active = true,
      updated_at = now()
    RETURNING program.id INTO v_program_id;
  ELSE
    UPDATE public.notas_programs AS program
       SET active = false,
           updated_at = now()
     WHERE program.account_id = v_account
       AND program.category_key = p_category_key
    RETURNING program.id INTO v_program_id;
  END IF;

  RETURN v_program_id;
END
$fn$;

REVOKE ALL ON FUNCTION public.notas_set_category_program(text, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.notas_set_category_program(text, boolean)
  TO authenticated;

CREATE OR REPLACE FUNCTION public.notas_sync_program_category()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
BEGIN
  IF TG_OP = 'DELETE' THEN
    UPDATE public.notas_programs
       SET active = false,
           updated_at = now()
     WHERE account_id = OLD.account_id
       AND category_key = OLD.key;
    RETURN OLD;
  END IF;

  UPDATE public.notas_programs
     SET name = NEW.label,
         color = coalesce(NEW.color, color),
         updated_at = now()
   WHERE account_id = NEW.account_id
     AND category_key = NEW.key;
  RETURN NEW;
END
$fn$;

REVOKE ALL ON FUNCTION public.notas_sync_program_category()
  FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_notas_sync_program_category ON public.custom_statuses;
CREATE TRIGGER trg_notas_sync_program_category
  AFTER UPDATE OF label, color OR DELETE
  ON public.custom_statuses
  FOR EACH ROW
  EXECUTE FUNCTION public.notas_sync_program_category();

CREATE OR REPLACE FUNCTION public.notas_complete_program_subnote(
  p_note_id uuid,
  p_title text DEFAULT NULL,
  p_content text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_uid uuid := auth.uid();
  v_account uuid := public.current_account_id();
  v_child record;
  v_root record;
  v_task record;
  v_program record;
  v_history_id uuid;
  v_reporter uuid;
  v_reporter_name text;
  v_completed_by_name text;
BEGIN
  IF public.notas_program_access_level() = 'NONE' THEN
    RAISE EXCEPTION 'sem permissão para concluir tarefas de programa';
  END IF;

  SELECT note.*
    INTO v_child
    FROM public.notes AS note
   WHERE note.id = p_note_id
   FOR UPDATE;

  IF NOT FOUND OR v_child.parent_note_id IS NULL THEN
    RAISE EXCEPTION 'a conclusão de programa aceita somente subnotas';
  END IF;

  IF NOT public.user_can_edit_note(p_note_id) THEN
    RAISE EXCEPTION 'sem permissão para editar esta subnota';
  END IF;

  SELECT note.*
    INTO v_root
    FROM public.notes AS note
   WHERE note.id = v_child.parent_note_id;

  IF NOT FOUND OR v_root.task_id IS NULL THEN
    RAISE EXCEPTION 'nota principal ou task vinculada não encontrada';
  END IF;

  SELECT task.*
    INTO v_task
    FROM public.tasks AS task
   WHERE task.id = v_root.task_id;

  IF NOT FOUND OR v_task.account_id IS DISTINCT FROM v_account THEN
    RAISE EXCEPTION 'task da nota principal fora da conta atual';
  END IF;

  SELECT program.*
    INTO v_program
    FROM public.notas_programs AS program
   WHERE program.account_id = v_account
     AND program.category_key = v_task.status
     AND program.active = true;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'a subnota não pertence a uma categoria de programa ativa';
  END IF;

  SELECT history.id
    INTO v_history_id
    FROM public.notas_program_history AS history
   WHERE history.note_id = p_note_id
     AND history.reopened_at IS NULL;

  IF v_history_id IS NOT NULL THEN
    RETURN v_history_id;
  END IF;

  v_reporter := coalesce(v_task.assignee_id, v_root.creator_id);

  SELECT coalesce(nullif(btrim(v_root.title), ''), profile.name, profile.email, 'Usuário')
    INTO v_reporter_name
    FROM public.profiles AS profile
   WHERE profile.id = v_reporter;

  v_reporter_name := coalesce(
    v_reporter_name,
    nullif(btrim(v_root.title), ''),
    'Usuário'
  );

  SELECT coalesce(profile.name, profile.email, 'Usuário')
    INTO v_completed_by_name
    FROM public.profiles AS profile
   WHERE profile.id = v_uid;

  INSERT INTO public.notas_program_history (
    account_id,
    program_id,
    note_id,
    root_note_id,
    category_key_snapshot,
    program_name_snapshot,
    root_title_snapshot,
    title_snapshot,
    content_snapshot,
    priority_snapshot,
    reporter_id,
    reporter_name_snapshot,
    completed_by,
    completed_by_name_snapshot,
    source_created_at,
    completed_at
  ) VALUES (
    v_account,
    v_program.id,
    v_child.id,
    v_root.id,
    v_program.category_key,
    v_program.name,
    coalesce(v_root.title, ''),
    coalesce(p_title, v_child.title, ''),
    coalesce(p_content, v_child.content, ''),
    v_child.priority::text,
    v_reporter,
    v_reporter_name,
    v_uid,
    coalesce(v_completed_by_name, 'Usuário'),
    v_child.created_at,
    now()
  )
  RETURNING id INTO v_history_id;

  PERFORM set_config('notas.program_history_write', '1', true);
  UPDATE public.notes
     SET is_archived = true,
         updated_at = now()
   WHERE id = p_note_id;

  RETURN v_history_id;
END
$fn$;

REVOKE ALL ON FUNCTION public.notas_complete_program_subnote(uuid, text, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.notas_complete_program_subnote(uuid, text, text)
  TO authenticated;

CREATE OR REPLACE FUNCTION public.notas_reopen_program_subnote(p_history_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_uid uuid := auth.uid();
  v_account uuid := public.current_account_id();
  v_history record;
BEGIN
  IF public.notas_program_access_level() = 'NONE' THEN
    RAISE EXCEPTION 'sem permissão para reabrir tarefas de programa';
  END IF;

  SELECT history.*
    INTO v_history
    FROM public.notas_program_history AS history
   WHERE history.id = p_history_id
     AND history.account_id = v_account
     AND history.reopened_at IS NULL
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'item de histórico não encontrado ou já reaberto';
  END IF;

  IF v_history.note_id IS NULL
     OR NOT EXISTS (SELECT 1 FROM public.notes WHERE id = v_history.note_id) THEN
    RAISE EXCEPTION 'a subnota original foi excluída e não pode ser reaberta';
  END IF;

  IF NOT public.user_can_edit_note(v_history.note_id) THEN
    RAISE EXCEPTION 'sem permissão para editar esta subnota';
  END IF;

  UPDATE public.notas_program_history
     SET reopened_at = now(),
         reopened_by = v_uid
   WHERE id = p_history_id;

  PERFORM set_config('notas.program_history_write', '1', true);
  UPDATE public.notes
     SET is_archived = false,
         updated_at = now()
   WHERE id = v_history.note_id;

  RETURN v_history.note_id;
END
$fn$;

REVOKE ALL ON FUNCTION public.notas_reopen_program_subnote(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.notas_reopen_program_subnote(uuid) TO authenticated;

-- Impede alterações diretas de is_archived em subnotas de programa. Toda
-- conclusão/reabertura precisa passar pelas RPCs para manter auditoria e métricas.
CREATE OR REPLACE FUNCTION public.notas_guard_program_subnote_archive()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_is_program boolean;
BEGIN
  IF NEW.is_archived IS NOT DISTINCT FROM OLD.is_archived
     OR NEW.parent_note_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT EXISTS (
    SELECT 1
      FROM public.notes AS root
      JOIN public.tasks AS task ON task.id = root.task_id
      JOIN public.notas_programs AS program
        ON program.account_id = task.account_id
       AND program.category_key = task.status
       AND program.active = true
     WHERE root.id = NEW.parent_note_id
  ) INTO v_is_program;

  IF v_is_program
     AND coalesce(current_setting('notas.program_history_write', true), '') <> '1' THEN
    RAISE EXCEPTION 'subnota de programa deve ser concluída/reaberta pela RPC de histórico';
  END IF;

  RETURN NEW;
END
$fn$;

REVOKE ALL ON FUNCTION public.notas_guard_program_subnote_archive()
  FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_notas_guard_program_subnote_archive ON public.notes;
CREATE TRIGGER trg_notas_guard_program_subnote_archive
  BEFORE UPDATE OF is_archived
  ON public.notes
  FOR EACH ROW
  EXECUTE FUNCTION public.notas_guard_program_subnote_archive();

-- A task da nota principal é um agrupador de pessoa dentro de uma categoria de
-- programa; ela não é uma entrega e não pode ir para DONE. As subnotas são as
-- unidades concluíveis.
CREATE OR REPLACE FUNCTION public.notas_guard_program_root_completion()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status
     AND NEW.status ~ '_DONE$'
     AND EXISTS (
       SELECT 1
         FROM public.notas_programs AS program
        WHERE program.account_id = OLD.account_id
          AND program.category_key = OLD.status
          AND program.active = true
     ) THEN
    RAISE EXCEPTION 'notas principais de programa são agrupadores; conclua as subnotas';
  END IF;

  RETURN NEW;
END
$fn$;

REVOKE ALL ON FUNCTION public.notas_guard_program_root_completion()
  FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_notas_guard_program_root_completion ON public.tasks;
CREATE TRIGGER trg_notas_guard_program_root_completion
  BEFORE UPDATE OF status
  ON public.tasks
  FOR EACH ROW
  EXECUTE FUNCTION public.notas_guard_program_root_completion();

CREATE OR REPLACE FUNCTION public.notas_program_history_list(
  p_program_id uuid,
  p_from timestamptz DEFAULT NULL,
  p_to timestamptz DEFAULT NULL
)
RETURNS TABLE (
  id uuid,
  program_id uuid,
  note_id uuid,
  root_note_id uuid,
  title text,
  content text,
  priority text,
  root_title text,
  reporter_id uuid,
  reporter_name text,
  completed_by uuid,
  completed_by_name text,
  source_created_at timestamptz,
  completed_at timestamptz,
  can_reopen boolean
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_account uuid := public.current_account_id();
  v_uid uuid := auth.uid();
  v_team boolean := public.notas_program_access_level() = 'TEAM';
BEGIN
  IF public.notas_program_access_level() = 'NONE' THEN
    RAISE EXCEPTION 'sem acesso ao histórico de programas';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.notas_programs AS program
     WHERE program.id = p_program_id
       AND program.account_id = v_account
  ) THEN
    RAISE EXCEPTION 'programa inexistente ou fora da conta atual';
  END IF;

  RETURN QUERY
  SELECT
    history.id,
    history.program_id,
    history.note_id,
    history.root_note_id,
    history.title_snapshot,
    left(history.content_snapshot, 500) AS content,
    history.priority_snapshot,
    history.root_title_snapshot,
    history.reporter_id,
    history.reporter_name_snapshot,
    CASE
      WHEN v_team OR history.completed_by = v_uid THEN history.completed_by
      ELSE NULL
    END AS completed_by,
    CASE
      WHEN v_team OR history.completed_by = v_uid THEN history.completed_by_name_snapshot
      ELSE 'Equipe'
    END AS completed_by_name,
    history.source_created_at,
    history.completed_at,
    history.note_id IS NOT NULL
      AND public.user_can_edit_note(history.note_id) AS can_reopen
  FROM public.notas_program_history AS history
  WHERE history.account_id = v_account
    AND history.program_id = p_program_id
    AND history.reopened_at IS NULL
    AND (p_from IS NULL OR history.completed_at >= p_from)
    AND (p_to IS NULL OR history.completed_at < p_to)
  ORDER BY history.completed_at DESC, history.id DESC;
END
$fn$;

REVOKE ALL ON FUNCTION public.notas_program_history_list(uuid, timestamptz, timestamptz)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.notas_program_history_list(uuid, timestamptz, timestamptz)
  TO authenticated;

CREATE OR REPLACE FUNCTION public.notas_program_history_metrics(
  p_program_id uuid,
  p_from timestamptz DEFAULT NULL,
  p_to timestamptz DEFAULT NULL
)
RETURNS TABLE (
  user_id uuid,
  user_name text,
  reported_count bigint,
  completed_count bigint
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_uid uuid := auth.uid();
  v_account uuid := public.current_account_id();
  v_team boolean := public.notas_program_access_level() = 'TEAM';
BEGIN
  IF public.notas_program_access_level() = 'NONE' THEN
    RAISE EXCEPTION 'sem acesso aos indicadores de programas';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.notas_programs AS program
     WHERE program.id = p_program_id
       AND program.account_id = v_account
  ) THEN
    RAISE EXCEPTION 'programa inexistente ou fora da conta atual';
  END IF;

  RETURN QUERY
  WITH scoped AS (
    SELECT history.*
      FROM public.notas_program_history AS history
     WHERE history.account_id = v_account
       AND history.program_id = p_program_id
       AND history.reopened_at IS NULL
       AND (p_from IS NULL OR history.completed_at >= p_from)
       AND (p_to IS NULL OR history.completed_at < p_to)
  ), contributions AS (
    SELECT
      history.reporter_id AS person_id,
      history.reporter_name_snapshot AS person_name,
      1::bigint AS reports,
      0::bigint AS completions
    FROM scoped AS history
    WHERE history.reporter_id IS NOT NULL

    UNION ALL

    SELECT
      history.completed_by AS person_id,
      history.completed_by_name_snapshot AS person_name,
      0::bigint AS reports,
      1::bigint AS completions
    FROM scoped AS history
    WHERE history.completed_by IS NOT NULL
  )
  SELECT
    contribution.person_id,
    max(contribution.person_name) AS user_name,
    sum(contribution.reports)::bigint AS reported_count,
    sum(contribution.completions)::bigint AS completed_count
  FROM contributions AS contribution
  WHERE v_team OR contribution.person_id = v_uid
  GROUP BY contribution.person_id
  ORDER BY sum(contribution.completions) DESC,
           sum(contribution.reports) DESC,
           max(contribution.person_name);
END
$fn$;

REVOKE ALL ON FUNCTION public.notas_program_history_metrics(uuid, timestamptz, timestamptz)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.notas_program_history_metrics(uuid, timestamptz, timestamptz)
  TO authenticated;

COMMIT;

-- Pós-aplicação sugerido:
-- SELECT public.notas_program_access_level();
-- SELECT id, category_key, name, active FROM public.notas_programs ORDER BY name;
-- SELECT * FROM public.notas_program_history_metrics('<program-id>', NULL, NULL);
