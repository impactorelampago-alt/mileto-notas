-- =============================================================================
-- Mileto Notas - somente Lembrete como categoria nativa visivel
-- =============================================================================
-- 1. Excluir uma categoria nunca apaga tasks, notes ou subnotes: tudo e movido
--    para o Lembrete (TODO) do mesmo dono dentro da mesma transacao.
-- 2. TODO e protegido; DONE e provisionado/protegido como estado tecnico oculto.
-- 3. A limpeza das categorias legadas da conta Mileto fica fora desta migration,
--    no script manual 20260810_cleanup_legacy_categories_mileto.sql.
-- 4. DONE permanece temporariamente como estado tecnico, pois o Ops e as RPCs
--    de concluir/reabrir ainda dependem dele. O front do Notas nao o exibe.
-- 5. Esta migration instala somente invariantes/RPCs; nao move nem remove dados.
--
-- Migration transacional, replay-safe; nao recria notes e preserva IDs.
-- =============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.notas_delete_category(p_category_key text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_owner_text text;
  v_owner uuid;
  v_suffix text;
  v_todo_key text;
  v_category_account uuid;
  v_owner_account uuid;
  v_todo_account uuid;
  v_start_position integer;
  v_moved integer := 0;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'usuario nao autenticado';
  END IF;

  IF p_category_key !~ '^USR_[0-9A-Fa-f]{32}_.+$' THEN
    RAISE EXCEPTION 'categoria invalida';
  END IF;

  v_owner_text := substring(p_category_key from '^USR_([0-9A-Fa-f]{32})_');
  v_owner := v_owner_text::uuid;
  v_suffix := substring(p_category_key from 38);
  v_todo_key := left(p_category_key, 37) || 'TODO';

  IF v_suffix = 'TODO' THEN
    RAISE EXCEPTION 'Lembrete nao pode ser excluido';
  ELSIF v_suffix = 'DONE' THEN
    RAISE EXCEPTION 'status tecnico de conclusao nao pode ser excluido';
  END IF;

  -- Trava a categoria durante toda a transacao. O trigger de integridade em
  -- tasks (abaixo) toma FOR KEY SHARE, fechando a corrida insert-vs-delete.
  SELECT status.account_id
    INTO v_category_account
    FROM public.custom_statuses AS status
   WHERE status.key = p_category_key
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'categoria nao encontrada';
  END IF;

  IF NOT public.is_super_admin()
     AND v_category_account IS DISTINCT FROM public.current_account_id() THEN
    RAISE EXCEPTION 'categoria pertence a outra conta';
  END IF;

  SELECT profile.account_id
    INTO v_owner_account
    FROM public.profiles AS profile
   WHERE profile.id = v_owner;
  IF NOT FOUND OR v_owner_account IS DISTINCT FROM v_category_account THEN
    RAISE EXCEPTION 'dono da categoria invalido para esta conta';
  END IF;

  IF v_owner <> auth.uid()
     AND NOT public.is_super_admin()
     AND NOT (
       public.notas_is_dono()
       AND v_category_account = public.current_account_id()
     ) THEN
    RAISE EXCEPTION 'sem permissao para excluir esta categoria';
  END IF;

  SELECT reminder.account_id
    INTO v_todo_account
    FROM public.custom_statuses AS reminder
   WHERE reminder.key = v_todo_key
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Lembrete do dono da categoria nao encontrado';
  END IF;
  IF v_todo_account IS DISTINCT FROM v_category_account THEN
    RAISE EXCEPTION 'Lembrete pertence a outra conta';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM public.tasks AS task
     WHERE task.status = p_category_key
       AND task.account_id IS DISTINCT FROM v_category_account
  ) THEN
    RAISE EXCEPTION 'categoria possui tarefa associada a outra conta';
  END IF;

  -- Serializa exclusoes/reaberturas que desembocam no mesmo TODO e acrescenta
  -- as tasks depois da maior position atual, preservando a ordem relativa.
  PERFORM pg_advisory_xact_lock(hashtextextended(v_todo_key, 0));
  SELECT COALESCE(MAX(task.position), -1)
    INTO v_start_position
    FROM public.tasks AS task
   WHERE task.status = v_todo_key
     AND task.account_id = v_category_account;

  WITH ordered AS (
    SELECT task.id,
           v_start_position
             + row_number() OVER (
                 ORDER BY task.position NULLS LAST, task.created_at, task.id
               )::integer AS new_position
      FROM public.tasks AS task
     WHERE task.status = p_category_key
       AND task.account_id = v_category_account
  )
  UPDATE public.tasks AS task
     SET status = v_todo_key,
         position = ordered.new_position
    FROM ordered
   WHERE task.id = ordered.id;
  GET DIAGNOSTICS v_moved = ROW_COUNT;

  -- A migration de grupos e independente e pode ter sido aplicada antes ou
  -- depois desta. Quando a tabela existir, remove a preferencia obsoleta.
  IF to_regclass('public.notas_category_group_items') IS NOT NULL THEN
    EXECUTE 'DELETE FROM public.notas_category_group_items WHERE category_key = $1 AND account_id = $2'
      USING p_category_key, v_category_account;
  END IF;

  DELETE FROM public.category_shares
   WHERE category_key = p_category_key;

  DELETE FROM public.custom_statuses
   WHERE key = p_category_key
     AND account_id = v_category_account;

  RETURN jsonb_build_object(
    'deleted_category', p_category_key,
    'reminder_key', v_todo_key,
    'moved_tasks', v_moved
  );
END;
$$;

REVOKE ALL ON FUNCTION public.notas_delete_category(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.notas_delete_category(text) FROM anon;
REVOKE ALL ON FUNCTION public.notas_delete_category(text) FROM service_role;
GRANT EXECUTE ON FUNCTION public.notas_delete_category(text) TO authenticated;

COMMENT ON FUNCTION public.notas_delete_category(text) IS
  'Exclui uma categoria de forma atomica, preservando tasks/notas ao move-las para o TODO do mesmo dono.';

-- Integridade que a tabela compartilhada ainda nao possui por FK: toda task com
-- key canonica precisa apontar para uma categoria existente da mesma conta. O
-- FOR KEY SHARE coopera com o FOR UPDATE da RPC de exclusao e impede que um
-- cliente antigo recrie uma task na categoria depois que ela foi removida.
CREATE OR REPLACE FUNCTION notas_private.validate_task_category()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_status_account uuid;
BEGIN
  IF NEW.status !~ '^USR_[0-9A-Fa-f]{32}_.+$' THEN
    RETURN NEW;
  END IF;

  SELECT status.account_id
    INTO v_status_account
    FROM public.custom_statuses AS status
   WHERE status.key = NEW.status
   FOR KEY SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'categoria da tarefa nao existe: %', NEW.status;
  END IF;

  IF NEW.account_id IS NULL THEN
    NEW.account_id := v_status_account;
  ELSIF NEW.account_id IS DISTINCT FROM v_status_account THEN
    RAISE EXCEPTION 'tarefa e categoria pertencem a contas diferentes';
  END IF;
  RETURN NEW;
END;
$$;

ALTER FUNCTION notas_private.validate_task_category() OWNER TO postgres;
REVOKE ALL ON FUNCTION notas_private.validate_task_category()
  FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_notas_validate_task_category_insert ON public.tasks;
CREATE TRIGGER trg_notas_validate_task_category_insert
  BEFORE INSERT ON public.tasks
  FOR EACH ROW EXECUTE FUNCTION notas_private.validate_task_category();

DROP TRIGGER IF EXISTS trg_notas_validate_task_category_update ON public.tasks;
CREATE TRIGGER trg_notas_validate_task_category_update
  BEFORE UPDATE OF status, account_id ON public.tasks
  FOR EACH ROW EXECUTE FUNCTION notas_private.validate_task_category();

-- Cria o unico default para perfis atuais que porventura nao o tenham e para
-- novos perfis. O trigger tambem cobre o momento em que account_id e atribuido
-- depois do INSERT inicial do perfil.
CREATE OR REPLACE FUNCTION notas_private.ensure_profile_reminder()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_key text;
  v_done_key text;
BEGIN
  IF NEW.account_id IS NULL
     OR NEW.account_id <> '48d41188-e1d7-4fc8-a878-8de2733ca215'::uuid THEN
    RETURN NEW;
  END IF;

  v_key := 'USR_' || replace(NEW.id::text, '-', '') || '_TODO';
  v_done_key := 'USR_' || replace(NEW.id::text, '-', '') || '_DONE';
  INSERT INTO public.custom_statuses
    (key, label, color, bg_color, position, account_id)
  VALUES
    (v_key, 'Lembrete', '#3b82f6', 'rgba(59,130,246,0.15)', 0, NEW.account_id)
  ON CONFLICT (key) DO UPDATE
    SET label = 'Lembrete'
    WHERE custom_statuses.account_id = EXCLUDED.account_id;

  -- O Ops atual usa a existencia de TODO como proxy de que o conjunto tecnico
  -- ja foi semeado. Garanta DONE junto para o fluxo de conclusao nunca ficar
  -- sem o destino fisico, embora ele permaneça oculto no Notas.
  INSERT INTO public.custom_statuses
    (key, label, color, bg_color, position, account_id)
  VALUES
    (v_done_key, 'Concluído', '#34d399', 'rgba(52,211,153,0.15)', 4, NEW.account_id)
  ON CONFLICT (key) DO NOTHING;
  RETURN NEW;
END;
$$;

ALTER FUNCTION notas_private.ensure_profile_reminder() OWNER TO postgres;
REVOKE ALL ON FUNCTION notas_private.ensure_profile_reminder()
  FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_notas_ensure_profile_reminder ON public.profiles;
CREATE TRIGGER trg_notas_ensure_profile_reminder
  AFTER INSERT OR UPDATE OF account_id ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION notas_private.ensure_profile_reminder();

INSERT INTO public.custom_statuses
  (key, label, color, bg_color, position, account_id)
SELECT 'USR_' || replace(profile.id::text, '-', '') || '_TODO',
       'Lembrete', '#3b82f6', 'rgba(59,130,246,0.15)', 0, profile.account_id
 FROM public.profiles AS profile
 WHERE profile.account_id = '48d41188-e1d7-4fc8-a878-8de2733ca215'::uuid
ON CONFLICT (key) DO UPDATE
  SET label = 'Lembrete'
  WHERE custom_statuses.account_id = EXCLUDED.account_id;

INSERT INTO public.custom_statuses
  (key, label, color, bg_color, position, account_id)
SELECT 'USR_' || replace(profile.id::text, '-', '') || '_DONE',
       'Concluído', '#34d399', 'rgba(52,211,153,0.15)', 4, profile.account_id
  FROM public.profiles AS profile
 WHERE profile.account_id = '48d41188-e1d7-4fc8-a878-8de2733ca215'::uuid
ON CONFLICT (key) DO NOTHING;

CREATE OR REPLACE FUNCTION public.notas_protect_reminder_category()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  -- DONE ainda e uma dependencia fisica do fluxo de concluir/reabrir nos dois
  -- aplicativos. Ele fica oculto no Notas, mas precisa existir ate a migracao
  -- completa para tasks.completed/completed_at.
  IF OLD.key ~ '^USR_[0-9A-Fa-f]{32}_DONE$'
     AND (
       TG_OP = 'DELETE'
       OR NEW.key IS DISTINCT FROM OLD.key
       OR NEW.account_id IS DISTINCT FROM OLD.account_id
     ) THEN
    RAISE EXCEPTION 'status tecnico de conclusao nao pode ser excluido nem ter sua chave alterada';
  END IF;

  IF OLD.key ~ '^USR_[0-9A-Fa-f]{32}_TODO$'
     AND OLD.account_id = '48d41188-e1d7-4fc8-a878-8de2733ca215'::uuid THEN
    IF TG_OP = 'DELETE'
       OR NEW.key IS DISTINCT FROM OLD.key
       OR NEW.account_id IS DISTINCT FROM OLD.account_id THEN
      RAISE EXCEPTION 'Lembrete nao pode ser excluido nem ter sua chave alterada';
    END IF;
    NEW.label := 'Lembrete';
  END IF;

  -- Clientes antigos (inclusive o Ops) apagavam custom_statuses diretamente.
  -- Se o UPDATE das tasks afetasse apenas o subconjunto visivel pela RLS, o
  -- DELETE ainda passava e deixava tasks/notas orfas. Exigir que dependencias
  -- tenham sido resolvidas antes faz clientes antigos falharem de modo seguro;
  -- a RPC e o script manual removem tasks/shares antes e continuam passando.
  IF TG_OP = 'DELETE' THEN
    IF EXISTS (SELECT 1 FROM public.tasks AS task WHERE task.status = OLD.key) THEN
      RAISE EXCEPTION 'categoria ainda possui tarefas; use notas_delete_category';
    END IF;
    IF EXISTS (
      SELECT 1 FROM public.category_shares AS share
       WHERE share.category_key = OLD.key
    ) THEN
      RAISE EXCEPTION 'categoria ainda possui compartilhamentos; use notas_delete_category';
    END IF;
  ELSIF NEW.key IS DISTINCT FROM OLD.key
        OR NEW.account_id IS DISTINCT FROM OLD.account_id THEN
    IF EXISTS (SELECT 1 FROM public.tasks AS task WHERE task.status = OLD.key)
       OR EXISTS (
         SELECT 1 FROM public.category_shares AS share
          WHERE share.category_key = OLD.key
       ) THEN
      RAISE EXCEPTION 'categoria em uso nao pode ter chave ou conta alterada';
    END IF;
  END IF;

  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

ALTER FUNCTION public.notas_protect_reminder_category() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.notas_protect_reminder_category()
  FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS trg_notas_protect_reminder_category ON public.custom_statuses;
CREATE TRIGGER trg_notas_protect_reminder_category
  BEFORE DELETE OR UPDATE ON public.custom_statuses
  FOR EACH ROW
  EXECUTE FUNCTION public.notas_protect_reminder_category();

-- Nome canonico do unico default exposto pelo Notas.
UPDATE public.custom_statuses
   SET label = 'Lembrete'
 WHERE key ~ '^USR_[0-9A-Fa-f]{32}_TODO$'
   AND account_id = '48d41188-e1d7-4fc8-a878-8de2733ca215'::uuid
   AND label IS DISTINCT FROM 'Lembrete';

-- A limpeza física das rows legadas é deliberadamente MANUAL e fica em
-- `supabase/manual/20260810_cleanup_legacy_categories_mileto.sql`. Separá-la da
-- migration automática permite backup, dry-run e conferência do Ops antes de
-- mover as tasks e excluir as colunas da conta Mileto.

-- A versão viva tratava qualquer DONO de qualquer tenant como autorizado. A
-- task agora precisa pertencer à conta do JWT (salvo superadmin explícito) antes
-- de avaliar dono, assignee, núcleo ou compartilhamentos.
CREATE OR REPLACE FUNCTION public.notas_can_complete_task(p_task_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
      FROM public.tasks AS task
     WHERE task.id = p_task_id
       AND (
         public.is_super_admin()
         OR task.account_id = public.current_account_id()
       )
       AND (
         public.is_super_admin()
         OR public.notas_is_dono()
         OR task.creator_id = auth.uid()
         OR task.assignee_id = auth.uid()
         OR task.creator_id IN (SELECT public.notas_editable_creator_ids())
         OR public.notas_category_shared_with_me(task.id)
         OR EXISTS (
           SELECT 1
             FROM public.note_shares AS share
             JOIN public.notes AS note ON note.id = share.note_id
            WHERE note.task_id = task.id
              AND share.shared_with = auth.uid()
              AND share.permission = 'EDIT'
         )
       )
  );
$$;

REVOKE ALL ON FUNCTION public.notas_can_complete_task(uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.notas_can_complete_task(uuid)
  TO authenticated, service_role;

-- Se a categoria de origem foi excluida enquanto a task estava em DONE, um
-- cliente antigo ainda pode enviar aquela key ao reabrir. Em vez de prender a
-- nota para sempre, cai no TODO canonico do mesmo dono/conta.
CREATE OR REPLACE FUNCTION public.notas_reopen_task(
  p_task_id uuid,
  p_target_status text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_cur text;
  v_creator uuid;
  v_assignee uuid;
  v_account uuid;
  v_uid uuid := auth.uid();
  v_target text := p_target_status;
  v_todo text;
  v_position integer;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'usuario nao autenticado';
  END IF;

  SELECT task.status, task.creator_id, task.assignee_id, task.account_id
    INTO v_cur, v_creator, v_assignee, v_account
    FROM public.tasks AS task
   WHERE task.id = p_task_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'tarefa nao encontrada';
  END IF;

  IF NOT public.is_super_admin()
     AND v_account IS DISTINCT FROM public.current_account_id() THEN
    RAISE EXCEPTION 'tarefa pertence a outra conta';
  END IF;

  v_todo := left(v_cur, 37) || 'TODO';
  IF v_target IS NULL THEN
    v_target := v_todo;
  ELSIF left(v_target, 37) <> left(v_cur, 37) THEN
    RAISE EXCEPTION 'status de destino invalido';
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM public.custom_statuses AS status
     WHERE status.key = v_target
       AND status.account_id = v_account
  ) THEN
    v_target := v_todo;
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM public.custom_statuses AS status
     WHERE status.key = v_target
       AND status.account_id = v_account
  ) THEN
    RAISE EXCEPTION 'Lembrete do dono da tarefa nao encontrado';
  END IF;

  IF NOT (
    v_creator = v_uid
    OR public.is_super_admin()
    OR (
      public.notas_is_dono()
      AND v_account = public.current_account_id()
    )
    OR v_assignee = v_uid
    OR v_creator IN (SELECT public.notas_editable_creator_ids())
    OR EXISTS (
      SELECT 1
        FROM public.category_shares AS share
       WHERE share.category_key = v_target
         AND share.shared_with = v_uid
    )
    OR EXISTS (
      SELECT 1
        FROM public.note_shares AS share
        JOIN public.notes AS note ON note.id = share.note_id
       WHERE note.task_id = p_task_id
         AND share.shared_with = v_uid
         AND share.permission = 'EDIT'
    )
  ) THEN
    RAISE EXCEPTION 'sem permissao para reabrir esta tarefa';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(v_target, 0));
  SELECT COALESCE(MAX(task.position), -1) + 1
    INTO v_position
    FROM public.tasks AS task
   WHERE task.status = v_target
     AND task.account_id = v_account;

  UPDATE public.tasks
     SET status = v_target,
         position = v_position
   WHERE id = p_task_id;
END;
$$;

REVOKE ALL ON FUNCTION public.notas_reopen_task(uuid, text)
  FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.notas_reopen_task(uuid, text)
  TO authenticated;

COMMIT;
