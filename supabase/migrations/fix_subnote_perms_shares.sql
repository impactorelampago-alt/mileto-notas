-- Corrige as funções de permissão de subnota para respeitarem o modelo REAL de
-- compartilhamento da produção. As versões originais (add_note_subnotes.sql, vindas
-- da linha master) só reconheciam criador + note_collaborators EDIT, ignorando
-- note_shares e category_shares — então um funcionário numa CATEGORIA COMPARTILHADA
-- não conseguia criar/ver subnotas nas notas do dono (RLS bloqueava o INSERT/SELECT).
--
-- Agora delegam para a lógica canônica do Notas:
--   user_can_edit_note = notas_can_edit_note (criador + note_shares EDIT + category_shares)
--                        + núcleo/DONO (notas_editable_creator_ids)
--   user_can_view_note = criador + note_shares (qualquer) + category_shares + núcleo/DONO
--
-- Status: ✅ APLICADO na VPS (ic-supabase-db), jul/2026.

CREATE OR REPLACE FUNCTION public.user_can_edit_note(target_note_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
  SELECT public.notas_can_edit_note(target_note_id)
    OR EXISTS (
      SELECT 1 FROM public.notes n
      WHERE n.id = target_note_id
        AND n.creator_id IN (SELECT public.notas_editable_creator_ids())
    );
$fn$;

CREATE OR REPLACE FUNCTION public.user_can_view_note(target_note_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
  SELECT EXISTS (
    SELECT 1 FROM public.notes n
    WHERE n.id = target_note_id
      AND (
        n.creator_id = auth.uid()
        OR n.creator_id IN (SELECT public.notas_visible_creator_ids())
        OR (n.task_id IS NOT NULL AND public.notas_category_shared_with_me(n.task_id))
      )
  )
  OR EXISTS (
    SELECT 1 FROM public.note_shares ns
    WHERE ns.note_id = target_note_id AND ns.shared_with = auth.uid()
  );
$fn$;
