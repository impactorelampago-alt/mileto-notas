-- ============================================================================
-- Tasks UPDATE: editores de categoria compartilhada + DONO/cargo_edit
-- (jun/2026, v1.4.2 — REVISADO na auditoria) — Mileto Notas
-- ----------------------------------------------------------------------------
-- Problema: ao salvar conteúdo de nota em categoria compartilhada / impersonação,
-- a nota é atualizada mas a task vinculada ficava sem policy de UPDATE para o
-- editor → description antiga do dono → o sync sobrescrevia o texto digitado.
--
-- ⚠️ CORREÇÕES DA AUDITORIA (2 bugs na 1ª versão desta migração):
--   1) Usava `creator_id = ANY(public.notas_editable_creator_ids())`, mas a função
--      retorna `setof uuid` — `ANY(setof)` é ERRO DE SINTAXE. Trocado por
--      `creator_id IN (SELECT public.notas_editable_creator_ids())`.
--   2) NÃO travava colunas no WITH CHECK → um editor (categoria compartilhada ou
--      cargo_edit) podia, via PATCH manual, MUDAR o `status` da task e movê-la para
--      a coluna de OUTRO dono no board do Ops (status só deve mudar via RPC
--      notas_complete_task/notas_reopen_task). Agora o WITH CHECK CONGELA
--      status/creator_id/assignee_id (espelha tasks_update_shared_editor do pacote 2):
--      o editor só altera title/description/priority.
--
-- PERMISSIVE (OR-combinadas com as policies do Ops, que permanecem intactas).
-- ⚠️ BANCO COMPARTILHADO COM O OPS — registrado no CLAUDE.md (A PASSAR PRO OPS).
-- Idempotente: dropa e recria as 2 policies.
-- ============================================================================

-- 1) Destinatário de categoria compartilhada (EDIT) — só title/description/priority.
DROP POLICY IF EXISTS notas_tasks_update_shared_editor ON public.tasks;
CREATE POLICY notas_tasks_update_shared_editor
  ON public.tasks AS PERMISSIVE FOR UPDATE TO authenticated
  USING ( public.notas_category_shared_with_me(id) AND creator_id <> auth.uid() )
  WITH CHECK (
    public.notas_category_shared_with_me(id)
    AND status      =                    (SELECT o.status      FROM public.tasks o WHERE o.id = tasks.id)
    AND creator_id  =                    (SELECT o.creator_id  FROM public.tasks o WHERE o.id = tasks.id)
    AND assignee_id IS NOT DISTINCT FROM (SELECT o.assignee_id FROM public.tasks o WHERE o.id = tasks.id)
  );

-- 2) DONO ou cargo_edit sobre o criador — também só title/description/priority.
--    (status/assignee/creator continuam imutáveis; mudança de coluna só via RPC.)
DROP POLICY IF EXISTS notas_tasks_update_nucleo_editor ON public.tasks;
CREATE POLICY notas_tasks_update_nucleo_editor
  ON public.tasks AS PERMISSIVE FOR UPDATE TO authenticated
  USING (
    creator_id <> auth.uid()
    AND (
      EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'DONO')
      OR creator_id IN (SELECT public.notas_editable_creator_ids())
    )
  )
  WITH CHECK (
    creator_id <> auth.uid()
    AND (
      EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'DONO')
      OR creator_id IN (SELECT public.notas_editable_creator_ids())
    )
    AND status      =                    (SELECT o.status      FROM public.tasks o WHERE o.id = tasks.id)
    AND creator_id  =                    (SELECT o.creator_id  FROM public.tasks o WHERE o.id = tasks.id)
    AND assignee_id IS NOT DISTINCT FROM (SELECT o.assignee_id FROM public.tasks o WHERE o.id = tasks.id)
  );

-- -------------------------------------------------------------------------------------
-- VALIDAÇÃO (logado como o EDITOR real, via app/token authenticated)
-- -------------------------------------------------------------------------------------
-- V1) Editar conteúdo: UPDATE tasks SET description='x' WHERE id=<task de terceiro>; -> 1 linha.
-- V2) Tentar mover de coluna: UPDATE tasks SET status='USR_<outro>_IN_PROGRESS' WHERE id=<task>; -> 0 linhas.
-- V3) Tentar reatribuir: UPDATE tasks SET assignee_id=auth.uid() WHERE id=<task>; -> 0 linhas.
