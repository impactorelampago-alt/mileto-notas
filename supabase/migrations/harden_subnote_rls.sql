-- Endurece a RLS de subnotas contra injeção em árvore alheia.
--
-- Contexto: a tabela `notes` tem uma política base PERMISSIVE `notes_creator_all`
-- (FOR ALL, WITH CHECK auth.uid() = creator_id). Como políticas PERMISSIVE do mesmo
-- comando são combinadas por OR, ela sozinha já autoriza qualquer INSERT/UPDATE onde
-- creator_id = auth.uid() — anulando a checagem `user_can_edit_note(parent_note_id)`
-- da política "Users can insert/update ... subnotes" (add_note_subnotes.sql).
--
-- Efeito do furo: um usuário autenticado que conheça o UUID de uma nota alheia poderia
-- inserir subnotas nela (ou re-parentear a própria subnota para dentro dela), poluindo
-- a árvore de outro usuário.
--
-- Correção: políticas RESTRICTIVE (combinadas por AND) exigem, para qualquer linha que
-- seja subnota, que o usuário tenha permissão de edição no pai. Notas raiz
-- (parent_note_id IS NULL) permanecem livres, então nada do fluxo atual quebra.

DROP POLICY IF EXISTS "Restrict subnote inserts to editable parents" ON notes;
CREATE POLICY "Restrict subnote inserts to editable parents"
ON notes
AS RESTRICTIVE
FOR INSERT
WITH CHECK (
  parent_note_id IS NULL
  OR public.user_can_edit_note(parent_note_id)
);

DROP POLICY IF EXISTS "Restrict subnote updates to editable parents" ON notes;
CREATE POLICY "Restrict subnote updates to editable parents"
ON notes
AS RESTRICTIVE
FOR UPDATE
WITH CHECK (
  parent_note_id IS NULL
  OR public.user_can_edit_note(parent_note_id)
);
