-- ============================================================================
-- Mileto Notas — histórico pessoal para todos os funcionários internos
-- Data: 2026-08-27
--
-- TEAM     (DONO/GERENTE/COORDENADOR): visão completa e escrita.
-- SELF     (cargo Programador): itens enviados/concluídos pelo próprio e escrita.
-- REPORTER (demais funcionários internos): somente itens enviados pelo próprio,
--          incluindo a identidade de quem concluiu; nenhuma escrita.
-- NONE     (sem perfil interno/conta): sem acesso.
--
-- O banco é compartilhado com o Mileto Ops. Esta migration não cria tabela nem
-- coluna, mas substitui seis RPCs/funções que o espelho de schema do Ops precisa
-- preservar com estas mesmas definições.
-- ============================================================================

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

DO $guard$
BEGIN
  IF to_regclass('public.profiles') IS NULL
     OR to_regclass('public.permission_settings') IS NULL
     OR to_regclass('public.custom_statuses') IS NULL
     OR to_regclass('public.category_shares') IS NULL
     OR to_regclass('public.notes') IS NULL
     OR to_regclass('public.tasks') IS NULL
     OR to_regclass('public.notas_programs') IS NULL
     OR to_regclass('public.notas_program_history') IS NULL THEN
    RAISE EXCEPTION 'Pré-requisitos do Histórico de Programas não encontrados';
  END IF;

  IF to_regprocedure('public.current_account_id()') IS NULL
     OR to_regprocedure('public.notas_programmer_cargo_keys(jsonb)') IS NULL
     OR to_regprocedure('public.notas_owns_category_key(text)') IS NULL
     OR to_regprocedure('public.user_can_edit_note(uuid)') IS NULL THEN
    RAISE EXCEPTION 'Helpers de conta/permissão do Histórico de Programas não encontrados';
  END IF;
END
$guard$;

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

  -- Usuários externos não possuem perfil interno vinculado a uma conta.
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

  IF v_is_programmer THEN
    RETURN 'SELF';
  END IF;

  RETURN 'REPORTER';
END
$fn$;

COMMENT ON FUNCTION public.notas_program_access_level() IS
  'Nível do Histórico: TEAM para gestão, SELF para Programador, REPORTER para demais funcionários internos e NONE para externos.';

REVOKE ALL ON FUNCTION public.notas_program_access_level() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.notas_program_access_level() TO authenticated, service_role;

-- Preserva a autorização já vigente para categorias próprias/compartilhadas,
-- mas separa a leitura REPORTER da permissão estrutural de configurar programa.
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
  IF public.notas_program_access_level() NOT IN ('TEAM', 'SELF') THEN
    RAISE EXCEPTION 'sem permissão para configurar categorias de programa';
  END IF;

  SELECT status.key, status.label, status.color, status.account_id
    INTO v_status
    FROM public.custom_statuses AS status
   WHERE status.key = p_category_key;

  IF NOT FOUND OR v_status.account_id IS DISTINCT FROM v_account THEN
    RAISE EXCEPTION 'categoria inexistente ou fora da conta atual';
  END IF;

  IF NOT (
    public.notas_owns_category_key(p_category_key)
    OR EXISTS (
      SELECT 1
        FROM public.category_shares AS share
       WHERE share.category_key = p_category_key
         AND share.shared_with = v_uid
    )
  ) THEN
    RAISE EXCEPTION 'somente o dono ou um destinatário da categoria compartilhada pode alterar seu tipo';
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

COMMENT ON FUNCTION public.notas_set_category_program(text, boolean) IS
  'Classifica categoria própria/compartilhada como programa; somente TEAM ou SELF podem executar.';

REVOKE ALL ON FUNCTION public.notas_set_category_program(text, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.notas_set_category_program(text, boolean)
  TO authenticated;

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
  IF public.notas_program_access_level() NOT IN ('TEAM', 'SELF') THEN
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

COMMENT ON FUNCTION public.notas_complete_program_subnote(uuid, text, text) IS
  'Conclui subnota de programa e cria snapshot auditável; somente TEAM ou SELF podem executar.';

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
  IF public.notas_program_access_level() NOT IN ('TEAM', 'SELF') THEN
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

COMMENT ON FUNCTION public.notas_reopen_program_subnote(uuid) IS
  'Reabre uma subnota concluída; somente TEAM ou SELF podem executar.';

REVOKE ALL ON FUNCTION public.notas_reopen_program_subnote(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.notas_reopen_program_subnote(uuid) TO authenticated;

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
  v_access text := public.notas_program_access_level();
BEGIN
  IF v_access = 'NONE' THEN
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
    history.completed_by,
    history.completed_by_name_snapshot,
    history.source_created_at,
    history.completed_at,
    v_access IN ('TEAM', 'SELF')
      AND history.note_id IS NOT NULL
      AND public.user_can_edit_note(history.note_id) AS can_reopen
  FROM public.notas_program_history AS history
  WHERE history.account_id = v_account
    AND history.program_id = p_program_id
    AND history.reopened_at IS NULL
    AND (p_from IS NULL OR history.completed_at >= p_from)
    AND (p_to IS NULL OR history.completed_at < p_to)
    AND (
      v_access = 'TEAM'
      OR (v_access = 'SELF' AND (
        history.reporter_id = v_uid
        OR history.completed_by = v_uid
      ))
      OR (v_access = 'REPORTER' AND history.reporter_id = v_uid)
    )
  ORDER BY history.completed_at DESC, history.id DESC;
END
$fn$;

COMMENT ON FUNCTION public.notas_program_history_list(uuid, timestamptz, timestamptz) IS
  'Lista o histórico por escopo: TEAM vê a conta, SELF vê envios/entregas próprios e REPORTER vê somente solicitações próprias com quem concluiu.';

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
  v_access text := public.notas_program_access_level();
BEGIN
  IF v_access = 'NONE' THEN
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
      'REPORT'::text AS contribution_kind,
      1::bigint AS reports,
      0::bigint AS completions
    FROM scoped AS history
    WHERE history.reporter_id IS NOT NULL

    UNION ALL

    SELECT
      history.completed_by AS person_id,
      history.completed_by_name_snapshot AS person_name,
      'COMPLETE'::text AS contribution_kind,
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
  WHERE v_access = 'TEAM'
     OR (v_access = 'SELF' AND contribution.person_id = v_uid)
     OR (
       v_access = 'REPORTER'
       AND contribution.person_id = v_uid
       AND contribution.contribution_kind = 'REPORT'
     )
  GROUP BY contribution.person_id
  ORDER BY sum(contribution.completions) DESC,
           sum(contribution.reports) DESC,
           max(contribution.person_name);
END
$fn$;

COMMENT ON FUNCTION public.notas_program_history_metrics(uuid, timestamptz, timestamptz) IS
  'Métricas por escopo: TEAM vê a conta, SELF vê a própria linha e REPORTER somente a própria contagem de envios.';

REVOKE ALL ON FUNCTION public.notas_program_history_metrics(uuid, timestamptz, timestamptz)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.notas_program_history_metrics(uuid, timestamptz, timestamptz)
  TO authenticated;

COMMIT;

-- Pós-aplicação sugerido:
-- 1. Simular um funcionário comum: access_level = REPORTER.
-- 2. Confirmar que history_list retorna somente reporter_id = auth.uid().
-- 3. Confirmar completed_by/completed_by_name reais e can_reopen = false.
-- 4. Confirmar que as três RPCs de escrita rejeitam REPORTER.
