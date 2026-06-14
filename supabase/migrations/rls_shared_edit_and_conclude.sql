-- =====================================================================================
-- MILETO NOTAS — PACOTE 2: EDICAO PELO DESTINATARIO + "CONCLUIR" (ADITIVO/IDEMPOTENTE)
-- Banco: self-hosted supabase.miletoops.com (rodar via docker exec psql). PRODUCAO.
-- Pre-requisito: o PACOTE 1 (rls_sharing_and_impersonation.sql) ja aplicado.
-- NAO usa trigger global (perigoso p/ o Ops web). UPDATE de tasks cross-owner so via RPC.
-- RODAR OS PRE-CHECKS DA SECAO 0 ANTES (so leitura) e revisar contra o schema real.
-- =====================================================================================
BEGIN;

-- -------------------------------------------------------------------------------------
-- 0) PRE-CHECKS (rode ISOLADO antes, so leitura; confirme premissas)
-- -------------------------------------------------------------------------------------
-- a) Policies atuais (precisamos saber se ja existe UPDATE em notes/tasks e o NOME):
--    SELECT tablename, policyname, cmd, permissive, qual, with_check FROM pg_policies
--      WHERE schemaname='public' AND tablename IN ('notes','tasks','custom_statuses')
--      ORDER BY tablename, cmd;
--    -> CONFIRMAR: existe a policy ALL "notes_creator_all" (creator_id=auth.uid())?
--       Se NAO existir, o dono pode perder UPDATE quando ligarmos RLS — NAO prosseguir
--       sem ela. (O brief afirma que existe; validar.)
-- b) Colunas de tasks (a guarda usa creator_id/assignee_id/status; updated_at opcional):
--    SELECT column_name FROM information_schema.columns
--      WHERE table_schema='public' AND table_name='tasks';
-- c) Prefixo dos status custom (esperado exatamente 37: 'USR_'+32hex+'_'):
--    SELECT DISTINCT length(left(status,37)), left(status,37) FROM public.tasks
--      WHERE status LIKE 'USR\_%' ESCAPE '\' LIMIT 20;
-- d) Existe a row DONE de cada dono em custom_statuses (a RPC valida, mas confirme):
--    SELECT key,label FROM public.custom_statuses WHERE key LIKE '%\_DONE' ESCAPE '\' LIMIT 20;
-- e) RLS atual de tasks/custom_statuses (precisamos saber se ja ha SELECT org-wide e UPDATE):
--    -> visto em (a). Se tasks SO tem SELECT por assignee_id, a secao 4 (SELECT aditivo) e necessaria.

-- -------------------------------------------------------------------------------------
-- 1) HELPERS NOVOS (SECURITY DEFINER, STABLE, search_path travado). Reusam os do PACOTE 1.
-- -------------------------------------------------------------------------------------

-- 1.a Tenho EDIT nesta NOTA? (dono da nota OU note_shares.permission='EDIT'
--     OU categoria da task compartilhada comigo). Categoria compartilhada => EDIT
--     (decisao de produto: category_shares hoje nao tem permission; ver secao 6 p/ VIEW).
CREATE OR REPLACE FUNCTION public.notas_can_edit_note(p_note_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT
    EXISTS (SELECT 1 FROM public.notes n
              WHERE n.id = p_note_id AND n.creator_id = auth.uid())
    OR EXISTS (SELECT 1 FROM public.note_shares ns
                 WHERE ns.note_id = p_note_id
                   AND ns.shared_with = auth.uid()
                   AND ns.permission = 'EDIT')
    OR EXISTS (SELECT 1 FROM public.notes n
                 WHERE n.id = p_note_id
                   AND n.task_id IS NOT NULL
                   AND public.notas_category_shared_with_me(n.task_id));
$$;

-- 1.b Posso EDITAR conteudo desta TASK? (existe alguma nota vinculada que eu posso editar).
--     Usado SO no caso de edicao mantendo o mesmo status.
CREATE OR REPLACE FUNCTION public.notas_can_edit_task(p_task_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT
    EXISTS (SELECT 1 FROM public.tasks t
              WHERE t.id = p_task_id AND t.creator_id = auth.uid())
    OR EXISTS (SELECT 1 FROM public.notes n
                 WHERE n.task_id = p_task_id AND public.notas_can_edit_note(n.id));
$$;

-- 1.c Tenho ACESSO p/ "Concluir" esta task? (dono/assignee OU DONO global OU
--     categoria compartilhada comigo OU nota vinculada compartilhada comigo — VIEW basta,
--     pois o requisito 4 pede Concluir "pro subordinado E pro dono").
CREATE OR REPLACE FUNCTION public.notas_can_complete_task(p_task_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT
    public.notas_is_dono()
    OR EXISTS (SELECT 1 FROM public.tasks t
                 WHERE t.id = p_task_id
                   AND (t.creator_id = auth.uid() OR t.assignee_id = auth.uid()))
    OR public.notas_category_shared_with_me(p_task_id)
    OR EXISTS (SELECT 1 FROM public.note_shares ns
                 JOIN public.notes n ON n.id = ns.note_id
                 WHERE n.task_id = p_task_id AND ns.shared_with = auth.uid());
$$;

GRANT EXECUTE ON FUNCTION public.notas_can_edit_note(uuid)      TO authenticated;
GRANT EXECUTE ON FUNCTION public.notas_can_edit_task(uuid)      TO authenticated;
GRANT EXECUTE ON FUNCTION public.notas_can_complete_task(uuid)  TO authenticated;

-- -------------------------------------------------------------------------------------
-- 2) UPDATE em NOTES pro destinatario EDIT — ADITIVA, sem trocar dono, sem DELETE.
--    WITH CHECK compara com o valor ANTIGO via subquery (nada de tautologia x=x).
--    Trava: nao muda creator_id, task_id, category_id, client_id, is_archived, is_pinned
--    (quem nao e dono so mexe em title/content/priority). O dono continua coberto pela
--    policy ALL pre-existente (notas_creator_all) — esta policy NAO o afeta.
-- -------------------------------------------------------------------------------------
DROP POLICY IF EXISTS notes_update_shared_editor ON public.notes;
CREATE POLICY notes_update_shared_editor
  ON public.notes
  AS PERMISSIVE
  FOR UPDATE
  TO authenticated
  USING ( public.notas_can_edit_note(id) AND creator_id <> auth.uid() )  -- so destinatario; dono usa a policy ALL dele
  WITH CHECK (
    public.notas_can_edit_note(id)
    AND creator_id  = (SELECT o.creator_id  FROM public.notes o WHERE o.id = notes.id)
    AND task_id     IS NOT DISTINCT FROM (SELECT o.task_id     FROM public.notes o WHERE o.id = notes.id)
    AND category_id IS NOT DISTINCT FROM (SELECT o.category_id FROM public.notes o WHERE o.id = notes.id)
    AND client_id   IS NOT DISTINCT FROM (SELECT o.client_id   FROM public.notes o WHERE o.id = notes.id)
    AND is_archived = (SELECT o.is_archived FROM public.notes o WHERE o.id = notes.id)
    AND is_pinned   = (SELECT o.is_pinned   FROM public.notes o WHERE o.id = notes.id)
  );

-- -------------------------------------------------------------------------------------
-- 3) UPDATE em TASKS pro destinatario EDIT — ADITIVA, SO conteudo, MESMO status.
--    "Concluir" (mudanca de status) NAO passa por aqui: vai pela RPC da secao 5.
--    Trava: nao muda status, creator_id, assignee_id. O dono/assignee continua livre
--    pela(s) policy(s) de UPDATE pre-existente(s) do Ops (sao OR — esta so AMPLIA).
-- -------------------------------------------------------------------------------------
DROP POLICY IF EXISTS tasks_update_shared_editor ON public.tasks;
CREATE POLICY tasks_update_shared_editor
  ON public.tasks
  AS PERMISSIVE
  FOR UPDATE
  TO authenticated
  USING ( public.notas_can_edit_task(id)
          AND creator_id <> auth.uid()
          AND (assignee_id IS DISTINCT FROM auth.uid()) )  -- so destinatario; dono/assignee usam as policies do Ops
  WITH CHECK (
    public.notas_can_edit_task(id)
    AND status      = (SELECT o.status      FROM public.tasks o WHERE o.id = tasks.id)  -- status IMUTAVEL aqui
    AND creator_id  = (SELECT o.creator_id  FROM public.tasks o WHERE o.id = tasks.id)
    AND assignee_id IS NOT DISTINCT FROM (SELECT o.assignee_id FROM public.tasks o WHERE o.id = tasks.id)
  );

-- -------------------------------------------------------------------------------------
-- 4) (CONDICIONAL) SELECT de TASKS compartilhadas comigo — APLIQUE SO SE o pre-check (a)
--    mostrar que tasks NAO tem SELECT que cubra o destinatario (ex.: so assignee_id=me).
--    Sem isto, o front nao consegue listar as tasks da categoria/nota compartilhada.
--    ADITIVA (OR). Se ja houver SELECT org-wide em tasks, PULE esta secao.
-- -------------------------------------------------------------------------------------
DROP POLICY IF EXISTS tasks_select_shared_with_me ON public.tasks;
CREATE POLICY tasks_select_shared_with_me
  ON public.tasks
  AS PERMISSIVE
  FOR SELECT
  TO authenticated
  USING (
    public.notas_is_dono()
    OR public.notas_category_shared_with_me(id)
    OR EXISTS (SELECT 1 FROM public.note_shares ns
                 JOIN public.notes n ON n.id = ns.note_id
                 WHERE n.task_id = tasks.id AND ns.shared_with = auth.uid())
  );
-- (custom_statuses: o brief diz org-wide. Se o pre-check mostrar que NAO e, criar policy
--  analoga de SELECT — sem ela as sections compartilhadas nao aparecem. VALIDAR.)

-- -------------------------------------------------------------------------------------
-- 5) RPC "CONCLUIR" — caminho unico e seguro p/ o botao. SECURITY DEFINER, valida acesso.
--    Move status -> DONE do MESMO dono, preservando o prefixo (left(status,37)||'DONE').
--    VALIDA que a key DONE existe em custom_statuses (evita status orfao se o prefixo
--    real divergir de 37). Status de SISTEMA tambem usam USR_<id>_<SUF>, entao a mesma
--    derivacao serve; nao ha fallback 'DONE' puro (que criaria orfao).
-- -------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.notas_complete_task(p_task_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_status text;
  v_done   text;
BEGIN
  SELECT status INTO v_status FROM public.tasks WHERE id = p_task_id;
  IF v_status IS NULL THEN
    RAISE EXCEPTION 'task inexistente';
  END IF;

  IF NOT public.notas_can_complete_task(p_task_id) THEN
    RAISE EXCEPTION 'sem permissao para concluir esta tarefa';
  END IF;

  -- Deriva a key DONE do MESMO dono preservando o prefixo de 37 chars.
  IF v_status LIKE 'USR\_%' ESCAPE '\' AND length(v_status) >= 37 THEN
    v_done := left(v_status, 37) || 'DONE';
  ELSE
    -- status sem o prefixo esperado: aborta em vez de gravar orfao.
    RAISE EXCEPTION 'status atual % nao tem o prefixo USR_<id>_ esperado', v_status;
  END IF;

  -- Garante que a coluna Concluido do dono REALMENTE existe (sem isto, status orfao).
  IF NOT EXISTS (SELECT 1 FROM public.custom_statuses cs WHERE cs.key = v_done) THEN
    RAISE EXCEPTION 'status DONE % nao existe em custom_statuses', v_done;
  END IF;

  IF v_status = v_done THEN
    RETURN;  -- ja concluida; no-op idempotente
  END IF;

  UPDATE public.tasks
     SET status = v_done
         /*, updated_at = now()*/   -- descomente se a coluna existir (pre-check b)
   WHERE id = p_task_id;
END;
$$;

REVOKE ALL ON FUNCTION public.notas_complete_task(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.notas_complete_task(uuid) TO authenticated;

COMMIT;

-- -------------------------------------------------------------------------------------
-- 6) (OPCIONAL) permission em category_shares p/ categoria VIEW-only.
--    Hoje compartilhar categoria => EDIT. Para distinguir VIEW/EDIT por categoria:
--    ALTER TABLE public.category_shares
--      ADD COLUMN IF NOT EXISTS permission text NOT NULL DEFAULT 'EDIT'
--      CHECK (permission IN ('VIEW','EDIT'));
--    e em notas_can_edit_note trocar o ramo de categoria por:
--      ... JOIN category_shares cs ON cs.category_key=t.status
--          WHERE ... AND cs.permission='EDIT'.

-- -------------------------------------------------------------------------------------
-- 7) ROLLBACK
-- -------------------------------------------------------------------------------------
-- DROP POLICY IF EXISTS notes_update_shared_editor ON public.notes;
-- DROP POLICY IF EXISTS tasks_update_shared_editor ON public.tasks;
-- DROP POLICY IF EXISTS tasks_select_shared_with_me ON public.tasks;
-- DROP FUNCTION IF EXISTS public.notas_complete_task(uuid);
-- DROP FUNCTION IF EXISTS public.notas_can_complete_task(uuid);
-- DROP FUNCTION IF EXISTS public.notas_can_edit_task(uuid);
-- DROP FUNCTION IF EXISTS public.notas_can_edit_note(uuid);

-- -------------------------------------------------------------------------------------
-- VALIDACAO POS-APLICACAO (logado como o DESTINATARIO real, via app/token authenticated)
-- -------------------------------------------------------------------------------------
-- V1) Edicao de nota compartilhada (EDIT): UPDATE notes SET content='x' WHERE id=<nota> ; -> deve afetar 1 linha.
-- V2) Tentativa de sequestro: UPDATE notes SET creator_id=auth.uid() WHERE id=<nota> ; -> deve afetar 0 / negar.
-- V3) Concluir: SELECT public.notas_complete_task('<task>'); -> task vai p/ a coluna DONE do dono.
-- V4) Tentativa de mover p/ outra coluna como destinatario:
--     UPDATE tasks SET status='USR_<outro>_IN_PROGRESS' WHERE id=<task>; -> 0 linhas (status imutavel na policy).
-- V5) Indices (performance das policies):
--     CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_note_shares_sw_perm ON public.note_shares (shared_with, note_id, permission);
--     (idx_tasks_status / idx_category_shares_* ja vieram no PACOTE 1.)