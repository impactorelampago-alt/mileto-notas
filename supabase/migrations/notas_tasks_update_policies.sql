-- ============================================================================
-- Tasks UPDATE: editores de categoria compartilhada + DONO/cargo_edit
-- (jun/2026, v1.4.2) — Mileto Notas
-- ----------------------------------------------------------------------------
-- Problema: ao salvar conteúdo de nota em categoria compartilhada, a nota é
-- atualizada (notes_update_shared_editor) mas a task fica dessincronizada
-- (sem policy UPDATE para o destinatário). Isso causava:
--   1) description da task ficando com conteúdo antigo do dono
--   2) syncNotesFromTaskDescriptions sobrescrevendo o texto do editor com o
--      conteúdo antigo (clock-skew: task.updated_at > note.updated_at)
--
-- Também: DONO/cargo_edit editando nota em impersonação não conseguia atualizar
-- a task vinculada — a nota ficava salva mas o Ops não refletia a mudança.
--
-- SOLUÇÃO: 2 policies PERMISSIVE (OR-combinadas com as existentes do Ops):
--   1. notas_tasks_update_shared_editor  — destinatário EDIT de categoria compartilhada
--   2. notas_tasks_update_nucleo_editor  — DONO ou cargo_edit sobre o criador
--
-- ⚠️  BANCO COMPARTILHADO COM O OPS — registrado no CLAUDE.md (A PASSAR PRO OPS).
-- As policies existentes do Ops permanecem intactas (PERMISSIVE = só adiciona).
-- ============================================================================

-- 1) Destinatário de categoria compartilhada (EDIT) pode atualizar tasks dela.
--    Reusa o helper SECURITY DEFINER notas_category_shared_with_me(task_id uuid)
--    que já existe (SELECT policy de tasks). O front só envia description/title/priority
--    nesse caminho (updateNote → notesPatch tasks), nunca muda status/assignee.
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'tasks'
      AND policyname = 'notas_tasks_update_shared_editor'
  ) THEN
    CREATE POLICY notas_tasks_update_shared_editor
    ON public.tasks FOR UPDATE TO authenticated
    USING      (public.notas_category_shared_with_me(id))
    WITH CHECK (public.notas_category_shared_with_me(id));
  END IF;
END $$;

-- 2) DONO ou usuário com cargo_edit sobre o criador da task pode atualizá-la.
--    notas_editable_creator_ids() retorna uuid[] (SECURITY DEFINER, já existia).
--    Restringe a tasks de OUTROS (creator_id != auth.uid()) para não conflitar
--    com a policy original do Ops que cobre as próprias tasks do usuário.
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'tasks'
      AND policyname = 'notas_tasks_update_nucleo_editor'
  ) THEN
    CREATE POLICY notas_tasks_update_nucleo_editor
    ON public.tasks FOR UPDATE TO authenticated
    USING (
      creator_id != auth.uid()
      AND (
        EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'DONO')
        OR creator_id = ANY(public.notas_editable_creator_ids())
      )
    )
    WITH CHECK (
      creator_id != auth.uid()
      AND (
        EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'DONO')
        OR creator_id = ANY(public.notas_editable_creator_ids())
      )
    );
  END IF;
END $$;
