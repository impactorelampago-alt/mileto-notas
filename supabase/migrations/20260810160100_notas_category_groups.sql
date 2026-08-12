-- ============================================================================
-- Mileto Notas — grupos pessoais recolhíveis para a lista de categorias
-- ----------------------------------------------------------------------------
-- Os grupos organizam `custom_statuses` somente na interface do Notas. A key da
-- categoria continua sendo a identidade canônica compartilhada com o Mileto Ops;
-- por isso os itens guardam apenas `category_key` e não alteram nenhuma tabela do
-- Ops. Uma categoria pode pertencer a no máximo um grupo por usuário.
--
-- Leitura segue a mesma visibilidade usada pela impersonação do Notas. Escrita é
-- estritamente pessoal (`auth.uid() = user_id`): o modo Todos/impersonação também
-- é bloqueado no front, mas o banco continua sendo a barreira de segurança.
-- Migration replay-safe: CREATE IF NOT EXISTS + policies/triggers recriados.
-- Pré-requisitos do banco compartilhado: public.notas_visible_creator_ids(),
-- public.current_account_id(), public.accounts e custom_statuses.account_id.
-- ============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.notas_category_groups (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id  uuid NOT NULL DEFAULT public.current_account_id()
              REFERENCES public.accounts(id) ON DELETE CASCADE,
  user_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name        text NOT NULL,
  position    integer NOT NULL DEFAULT 0,
  collapsed   boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT notas_category_groups_name_nonempty
    CHECK (char_length(btrim(name)) BETWEEN 1 AND 80),
  CONSTRAINT notas_category_groups_position_nonnegative
    CHECK (position >= 0),
  CONSTRAINT notas_category_groups_id_user_account_unique
    UNIQUE (id, user_id, account_id)
);

CREATE INDEX IF NOT EXISTS idx_notas_category_groups_user_position
  ON public.notas_category_groups (account_id, user_id, position, created_at, id);

CREATE UNIQUE INDEX IF NOT EXISTS uq_notas_category_groups_user_name_ci
  ON public.notas_category_groups (account_id, user_id, lower(btrim(name)));

CREATE TABLE IF NOT EXISTS public.notas_category_group_items (
  account_id    uuid NOT NULL DEFAULT public.current_account_id()
                REFERENCES public.accounts(id) ON DELETE CASCADE,
  user_id       uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  category_key  text NOT NULL,
  group_id      uuid,
  position      integer NOT NULL DEFAULT 0,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT notas_category_group_items_pk
    PRIMARY KEY (account_id, user_id, category_key),
  CONSTRAINT notas_category_group_items_key_nonempty
    CHECK (char_length(btrim(category_key)) >= 1),
  CONSTRAINT notas_category_group_items_position_nonnegative
    CHECK (position >= 0),
  CONSTRAINT notas_category_group_items_group_owner_fk
    FOREIGN KEY (group_id, user_id, account_id)
    REFERENCES public.notas_category_groups (id, user_id, account_id)
    ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_notas_category_group_items_group_position
  ON public.notas_category_group_items (account_id, user_id, group_id, position, category_key);

-- Um único trigger mantém updated_at nas duas tabelas. Não depende de extensões
-- ou helpers genéricos do Ops, evitando colisão no banco compartilhado.
CREATE OR REPLACE FUNCTION public.notas_touch_category_group_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $fn$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$fn$;

REVOKE ALL PRIVILEGES
  ON FUNCTION public.notas_touch_category_group_updated_at()
  FROM PUBLIC, anon;

DROP TRIGGER IF EXISTS trg_notas_category_groups_updated_at
  ON public.notas_category_groups;
CREATE TRIGGER trg_notas_category_groups_updated_at
  BEFORE UPDATE ON public.notas_category_groups
  FOR EACH ROW
  EXECUTE FUNCTION public.notas_touch_category_group_updated_at();

DROP TRIGGER IF EXISTS trg_notas_category_group_items_updated_at
  ON public.notas_category_group_items;
CREATE TRIGGER trg_notas_category_group_items_updated_at
  BEFORE UPDATE ON public.notas_category_group_items
  FOR EACH ROW
  EXECUTE FUNCTION public.notas_touch_category_group_updated_at();

ALTER TABLE public.notas_category_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notas_category_group_items ENABLE ROW LEVEL SECURITY;

-- Barreira RESTRICTIVE separada: mesmo que uma policy permissiva seja adicionada
-- no futuro para gestão/impersonação, ela nunca atravessa a conta do JWT atual.
DROP POLICY IF EXISTS notas_category_groups_account_isolation
  ON public.notas_category_groups;
CREATE POLICY notas_category_groups_account_isolation
  ON public.notas_category_groups
  AS RESTRICTIVE
  FOR ALL
  TO authenticated
  USING (account_id = public.current_account_id())
  WITH CHECK (account_id = public.current_account_id());

DROP POLICY IF EXISTS notas_category_group_items_account_isolation
  ON public.notas_category_group_items;
CREATE POLICY notas_category_group_items_account_isolation
  ON public.notas_category_group_items
  AS RESTRICTIVE
  FOR ALL
  TO authenticated
  USING (account_id = public.current_account_id())
  WITH CHECK (account_id = public.current_account_id());

-- O usuário real vê a própria organização. Gestores/DONO também podem ler a
-- organização da conta efetiva quando entram nela, conforme a árvore de núcleos.
DROP POLICY IF EXISTS notas_category_groups_select_visible
  ON public.notas_category_groups;
CREATE POLICY notas_category_groups_select_visible
  ON public.notas_category_groups
  AS PERMISSIVE
  FOR SELECT
  TO authenticated
  USING (
    account_id = public.current_account_id()
    AND
    user_id IN (SELECT public.notas_visible_creator_ids())
  );

DROP POLICY IF EXISTS notas_category_groups_insert_own
  ON public.notas_category_groups;
CREATE POLICY notas_category_groups_insert_own
  ON public.notas_category_groups
  AS PERMISSIVE
  FOR INSERT
  TO authenticated
  WITH CHECK (
    auth.uid() = user_id
    AND account_id = public.current_account_id()
  );

DROP POLICY IF EXISTS notas_category_groups_update_own
  ON public.notas_category_groups;
CREATE POLICY notas_category_groups_update_own
  ON public.notas_category_groups
  AS PERMISSIVE
  FOR UPDATE
  TO authenticated
  USING (
    auth.uid() = user_id
    AND account_id = public.current_account_id()
  )
  WITH CHECK (
    auth.uid() = user_id
    AND account_id = public.current_account_id()
  );

DROP POLICY IF EXISTS notas_category_groups_delete_own
  ON public.notas_category_groups;
CREATE POLICY notas_category_groups_delete_own
  ON public.notas_category_groups
  AS PERMISSIVE
  FOR DELETE
  TO authenticated
  USING (
    auth.uid() = user_id
    AND account_id = public.current_account_id()
  );

DROP POLICY IF EXISTS notas_category_group_items_select_visible
  ON public.notas_category_group_items;
CREATE POLICY notas_category_group_items_select_visible
  ON public.notas_category_group_items
  AS PERMISSIVE
  FOR SELECT
  TO authenticated
  USING (
    account_id = public.current_account_id()
    AND
    user_id IN (SELECT public.notas_visible_creator_ids())
  );

DROP POLICY IF EXISTS notas_category_group_items_insert_own
  ON public.notas_category_group_items;
CREATE POLICY notas_category_group_items_insert_own
  ON public.notas_category_group_items
  AS PERMISSIVE
  FOR INSERT
  TO authenticated
  WITH CHECK (
    auth.uid() = user_id
    AND account_id = public.current_account_id()
    AND EXISTS (
      SELECT 1
      FROM public.custom_statuses AS status
      WHERE status.key = category_key
        AND status.account_id = notas_category_group_items.account_id
    )
  );

DROP POLICY IF EXISTS notas_category_group_items_update_own
  ON public.notas_category_group_items;
CREATE POLICY notas_category_group_items_update_own
  ON public.notas_category_group_items
  AS PERMISSIVE
  FOR UPDATE
  TO authenticated
  USING (
    auth.uid() = user_id
    AND account_id = public.current_account_id()
  )
  WITH CHECK (
    auth.uid() = user_id
    AND account_id = public.current_account_id()
    AND EXISTS (
      SELECT 1
      FROM public.custom_statuses AS status
      WHERE status.key = category_key
        AND status.account_id = notas_category_group_items.account_id
    )
  );

DROP POLICY IF EXISTS notas_category_group_items_delete_own
  ON public.notas_category_group_items;
CREATE POLICY notas_category_group_items_delete_own
  ON public.notas_category_group_items
  AS PERMISSIVE
  FOR DELETE
  TO authenticated
  USING (
    auth.uid() = user_id
    AND account_id = public.current_account_id()
  );

REVOKE ALL PRIVILEGES
  ON TABLE public.notas_category_groups, public.notas_category_group_items
  FROM PUBLIC, anon;

GRANT SELECT, INSERT, UPDATE, DELETE
  ON TABLE public.notas_category_groups, public.notas_category_group_items
  TO authenticated, service_role;

COMMENT ON TABLE public.notas_category_groups IS
  'Grupos pessoais e recolhíveis usados apenas para organizar categorias no Mileto Notas.';
COMMENT ON TABLE public.notas_category_group_items IS
  'Posição e grupo pessoal de cada category_key exibida pelo Mileto Notas.';
COMMENT ON COLUMN public.notas_category_group_items.group_id IS
  'NULL representa categoria sem grupo; ao excluir um grupo, seus itens somem e as categorias voltam a ficar sem grupo.';

COMMIT;
