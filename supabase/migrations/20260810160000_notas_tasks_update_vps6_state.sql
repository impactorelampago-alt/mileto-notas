-- ============================================================================
-- Mileto Notas — versiona o drift manual confirmado no estado vivo da VPS6
-- 2026-08-10 (migration Supabase 20260810160000)
--
-- Inclui as policies de leitura/escrita do Notas, a trava anti-autopromoção de
-- perfil e os helpers SECURITY DEFINER dos quais elas dependem. Os helpers de
-- UPDATE evitam consultar public.tasks diretamente dentro da policy RLS da
-- própria tabela, o que pode causar recursão de policy.
-- Aplicar como postgres. A policy do Ops "Enable update for hierarchy" não é
-- alterada por esta migration.
-- Pré-requisitos: rls_sharing_and_impersonation.sql,
-- notas_nucleo_visibility.sql e add_note_priority_and_client_annotations.sql.
-- Esta migration é forward-only e deve rodar depois delas, não isoladamente.
-- ============================================================================

BEGIN;

-- Helpers internos ficam fora do schema exposto pelo PostgREST. Assim podem ser
-- usados pelas policies sem virar RPCs públicas capazes de ignorar a RLS.
CREATE SCHEMA IF NOT EXISTS notas_private AUTHORIZATION postgres;
REVOKE ALL ON SCHEMA notas_private FROM PUBLIC, anon;
GRANT USAGE ON SCHEMA notas_private TO authenticated, service_role;

CREATE OR REPLACE FUNCTION notas_private.task_note_shared_with_me(
  p_task_id uuid,
  p_need_edit boolean DEFAULT false
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
  SELECT EXISTS (
    SELECT 1
    FROM public.notes AS note
    JOIN public.note_shares AS share ON share.note_id = note.id
    WHERE note.task_id = p_task_id
      AND share.shared_with = auth.uid()
      AND (NOT p_need_edit OR share.permission = 'EDIT')
  );
$fn$;

-- Compara a row nova com a row persistida inteira. Só os metadados realmente
-- editados pelo Notas ficam fora da comparação; todo campo atual ou que venha a
-- ser adicionado ao schema permanece congelado por padrão.
CREATE OR REPLACE FUNCTION notas_private.task_notas_update_allowed(
  p_new public.tasks
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
  SELECT EXISTS (
    SELECT 1
    FROM public.tasks AS old_task
    WHERE old_task.id = p_new.id
      AND (
        to_jsonb(old_task)
          - ARRAY[
              'title', 'description', 'priority', 'position', 'due_date',
              'client_id', 'recurrence', 'parent_template_id', 'updated_at'
            ]::text[]
      ) IS NOT DISTINCT FROM (
        to_jsonb(p_new)
          - ARRAY[
              'title', 'description', 'priority', 'position', 'due_date',
              'client_id', 'recurrence', 'parent_template_id', 'updated_at'
            ]::text[]
      )
  );
$fn$;

CREATE OR REPLACE FUNCTION notas_private.category_key_in_current_account(
  p_category_key text
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
  SELECT EXISTS (
    SELECT 1
    FROM public.custom_statuses AS status
    WHERE status.key = p_category_key
      AND status.account_id = public.current_account_id()
  );
$fn$;

ALTER FUNCTION notas_private.task_note_shared_with_me(uuid, boolean) OWNER TO postgres;
ALTER FUNCTION notas_private.task_notas_update_allowed(public.tasks) OWNER TO postgres;
ALTER FUNCTION notas_private.category_key_in_current_account(text) OWNER TO postgres;
REVOKE ALL ON FUNCTION notas_private.task_note_shared_with_me(uuid, boolean)
  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION notas_private.task_notas_update_allowed(public.tasks)
  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION notas_private.category_key_in_current_account(text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION notas_private.task_note_shared_with_me(uuid, boolean)
  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION notas_private.task_notas_update_allowed(public.tasks)
  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION notas_private.category_key_in_current_account(text)
  TO authenticated, service_role;

-- Papel atual do usuário real. Usado no WITH CHECK de profiles para impedir
-- que um usuário troque o próprio cargo por UPDATE direto.
CREATE OR REPLACE FUNCTION public.notas_current_role()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
  SELECT p.role::text
  FROM public.profiles AS p
  WHERE p.id = auth.uid();
$fn$;

-- Acesso à task por compartilhamento individual da nota vinculada.
CREATE OR REPLACE FUNCTION public.notas_task_note_shared_with_me(
  p_task_id uuid,
  p_need_edit boolean DEFAULT false
)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
  SELECT EXISTS (
    SELECT 1
    FROM public.notes AS n
    JOIN public.note_shares AS ns ON ns.note_id = n.id
    WHERE n.task_id = p_task_id
      AND ns.shared_with = auth.uid()
      AND (NOT p_need_edit OR ns.permission = 'EDIT')
  );
$fn$;

-- Valores atuais da task, lidos pelo owner postgres fora da RLS.
CREATE OR REPLACE FUNCTION public.notas_task_status_of(p_id uuid)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
  SELECT t.status
  FROM public.tasks AS t
  WHERE t.id = p_id;
$fn$;

CREATE OR REPLACE FUNCTION public.notas_task_creator_of(p_id uuid)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
  SELECT t.creator_id
  FROM public.tasks AS t
  WHERE t.id = p_id;
$fn$;

CREATE OR REPLACE FUNCTION public.notas_task_assignee_of(p_id uuid)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
  SELECT t.assignee_id
  FROM public.tasks AS t
  WHERE t.id = p_id;
$fn$;

ALTER FUNCTION public.notas_current_role() OWNER TO postgres;
ALTER FUNCTION public.notas_task_note_shared_with_me(uuid, boolean) OWNER TO postgres;
ALTER FUNCTION public.notas_task_status_of(uuid) OWNER TO postgres;
ALTER FUNCTION public.notas_task_creator_of(uuid) OWNER TO postgres;
ALTER FUNCTION public.notas_task_assignee_of(uuid) OWNER TO postgres;

-- CREATE FUNCTION concede EXECUTE a PUBLIC por padrão. A VPS6 também tinha
-- grants para anon; ambos são desnecessários para os fluxos legítimos do app.
REVOKE ALL PRIVILEGES
  ON FUNCTION public.notas_current_role()
  FROM PUBLIC, anon;
REVOKE ALL PRIVILEGES
  ON FUNCTION public.notas_task_note_shared_with_me(uuid, boolean)
  FROM PUBLIC, anon;
REVOKE ALL PRIVILEGES
  ON FUNCTION public.notas_task_note_shared_with_me(uuid, boolean)
  FROM authenticated;
REVOKE ALL PRIVILEGES
  ON FUNCTION public.notas_task_status_of(uuid)
  FROM PUBLIC, anon;
REVOKE ALL PRIVILEGES
  ON FUNCTION public.notas_task_creator_of(uuid)
  FROM PUBLIC, anon;
REVOKE ALL PRIVILEGES
  ON FUNCTION public.notas_task_assignee_of(uuid)
  FROM PUBLIC, anon;

GRANT EXECUTE
  ON FUNCTION public.notas_current_role()
  TO authenticated, service_role;
GRANT EXECUTE
  ON FUNCTION public.notas_task_note_shared_with_me(uuid, boolean)
  TO service_role;

-- Os três getters existem na VPS por compatibilidade, mas não são necessários
-- para clientes depois da policy por snapshot. Remover EXECUTE impede que sejam
-- usados como RPC para ler uma task conhecida fora da RLS.
REVOKE ALL PRIVILEGES
  ON FUNCTION public.notas_task_status_of(uuid)
  FROM authenticated;
REVOKE ALL PRIVILEGES
  ON FUNCTION public.notas_task_creator_of(uuid)
  FROM authenticated;
REVOKE ALL PRIVILEGES
  ON FUNCTION public.notas_task_assignee_of(uuid)
  FROM authenticated;
GRANT EXECUTE
  ON FUNCTION public.notas_task_status_of(uuid),
              public.notas_task_creator_of(uuid),
              public.notas_task_assignee_of(uuid)
  TO service_role;

-- Policies PERMISSIVE antigas precisam sair: se uma versão frouxa permanecer,
-- ela pode contornar o WITH CHECK das policies canônicas abaixo.
DROP POLICY IF EXISTS "Enable all access for authenticated users" ON public.tasks;
DROP POLICY IF EXISTS tasks_select_shared_with_me ON public.tasks;
DROP POLICY IF EXISTS tasks_update_shared_editor ON public.tasks;
DROP POLICY IF EXISTS notas_tasks_update_shared_editor ON public.tasks;

DROP POLICY IF EXISTS tasks_select_notas_scoped ON public.tasks;
CREATE POLICY tasks_select_notas_scoped
  ON public.tasks
  AS PERMISSIVE
  FOR SELECT
  TO authenticated
  USING (
    status ~ ('^USR_' || replace(auth.uid()::text, '-', '') || '_')
    OR public.notas_category_shared_with_me(id)
    OR notas_private.task_note_shared_with_me(id, false)
  );

DROP POLICY IF EXISTS tasks_update_notas_shared ON public.tasks;
CREATE POLICY tasks_update_notas_shared
  ON public.tasks
  AS PERMISSIVE
  FOR UPDATE
  TO authenticated
  USING (
    public.notas_category_shared_with_me(id)
    OR notas_private.task_note_shared_with_me(id, true)
  )
  WITH CHECK (
    (
      public.notas_category_shared_with_me(id)
      OR notas_private.task_note_shared_with_me(id, true)
    )
    AND notas_private.task_notas_update_allowed(tasks)
  );

DROP POLICY IF EXISTS notas_tasks_update_nucleo_editor ON public.tasks;
CREATE POLICY notas_tasks_update_nucleo_editor
  ON public.tasks
  AS PERMISSIVE
  FOR UPDATE
  TO authenticated
  USING (
    creator_id <> auth.uid()
    AND creator_id IN (
      SELECT public.notas_editable_creator_ids()
    )
  )
  WITH CHECK (
    creator_id <> auth.uid()
    AND creator_id IN (
      SELECT public.notas_editable_creator_ids()
    )
    AND notas_private.task_notas_update_allowed(tasks)
  );

-- DONO enxerga todos os compartilhamentos de categoria, inclusive ao
-- impersonar outro usuário no front.
DROP POLICY IF EXISTS category_shares_account_isolation
  ON public.category_shares;
CREATE POLICY category_shares_account_isolation
  ON public.category_shares
  AS RESTRICTIVE
  FOR ALL
  TO authenticated
  USING (
    public.is_super_admin()
    OR notas_private.category_key_in_current_account(category_key)
  )
  WITH CHECK (
    public.is_super_admin()
    OR notas_private.category_key_in_current_account(category_key)
  );

DROP POLICY IF EXISTS category_shares_dono_reads_all ON public.category_shares;
CREATE POLICY category_shares_dono_reads_all
  ON public.category_shares
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING (
    public.is_super_admin()
    OR (
      public.notas_is_dono()
      AND notas_private.category_key_in_current_account(category_key)
    )
  );

-- Estado vivo da tabela do Notas. O fluxo atual grava observações novas em
-- clients.notes, mas esta policy mantém seguro o caminho legado de UPDATE.
DROP POLICY IF EXISTS "Users can update own annotations"
  ON public.note_client_annotations;
CREATE POLICY "Users can update own annotations"
  ON public.note_client_annotations
  AS PERMISSIVE
  FOR UPDATE
  TO public
  USING (created_by = auth.uid())
  WITH CHECK (created_by = auth.uid());

-- Barreira de coluna para autoedição. `is_super_admin()` lê `is_platform`; sem
-- este trigger um usuário poderia marcar o próprio perfil como plataforma antes
-- mesmo da policy conferir o cargo. Gestores continuam podendo administrar
-- terceiros conforme as policies do Ops; o próprio usuário só edita campos não
-- administrativos.
CREATE OR REPLACE FUNCTION notas_private.protect_own_profile_admin_fields()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
BEGIN
  IF auth.uid() = OLD.id
     AND NOT public.is_super_admin()
     AND (
       NEW.role IS DISTINCT FROM OLD.role
       OR NEW.is_platform IS DISTINCT FROM OLD.is_platform
       OR NEW.account_id IS DISTINCT FROM OLD.account_id
       OR NEW.permission_overrides IS DISTINCT FROM OLD.permission_overrides
       OR NEW.supervisor_id IS DISTINCT FROM OLD.supervisor_id
       OR NEW.salary IS DISTINCT FROM OLD.salary
     ) THEN
    RAISE EXCEPTION 'campos administrativos do proprio perfil nao podem ser alterados';
  END IF;
  RETURN NEW;
END;
$fn$;

ALTER FUNCTION notas_private.protect_own_profile_admin_fields() OWNER TO postgres;
REVOKE ALL ON FUNCTION notas_private.protect_own_profile_admin_fields()
  FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_notas_protect_own_profile_admin_fields
  ON public.profiles;
CREATE TRIGGER trg_notas_protect_own_profile_admin_fields
  BEFORE UPDATE OF role, is_platform, account_id, permission_overrides, supervisor_id, salary
  ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION notas_private.protect_own_profile_admin_fields();

-- A policy mantém a checagem declarativa de role além do trigger acima.
DROP POLICY IF EXISTS "Users can update own profile" ON public.profiles;
CREATE POLICY "Users can update own profile"
  ON public.profiles
  AS PERMISSIVE
  FOR UPDATE
  TO public
  USING (auth.uid() = id)
  WITH CHECK (
    auth.uid() = id
    AND NOT (role::text IS DISTINCT FROM public.notas_current_role())
  );

COMMIT;
