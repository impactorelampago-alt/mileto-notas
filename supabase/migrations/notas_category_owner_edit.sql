-- ============================================================================
-- Mileto Notas — DONO da categoria edita as notas que OUTROS criaram nela
-- ----------------------------------------------------------------------------
-- Categoria compartilhada = espaço colaborativo. O DESTINATÁRIO do share já
-- editava as notas dos outros (notes_update_shared_editor / tasks_update_notas_shared).
-- Faltava o DONO da categoria: ele criou a categoria e compartilhou, mas NÃO
-- conseguia editar a NOTA que um funcionário criou nela (a task ele já editava).
-- Também não via/criava SUBNOTAS nessas notas.
--
-- Fix (aditivo, idempotente): usa notas_owns_category_key(key) (= DONO OU key
-- começa com o prefixo do usuário). Nada removido; destinatário/núcleo/DONO seguem.
-- Reserva de nomes: notas_* / user_can_*_note são do Notas.
-- ============================================================================

-- 1) UPDATE da nota-raiz pelo DONO da categoria (a task já era editável por ele).
--    WITH CHECK com a MESMA condição: a nota tem que continuar numa categoria dele
--    (não dá pra "mover" a nota pra categoria de outro dono).
drop policy if exists notes_update_category_owner on public.notes;
create policy notes_update_category_owner on public.notes
  for update
  using (
    task_id is not null and exists (
      select 1 from public.tasks t
      where t.id = notes.task_id and public.notas_owns_category_key(t.status)
    )
  )
  with check (
    task_id is not null and exists (
      select 1 from public.tasks t
      where t.id = notes.task_id and public.notas_owns_category_key(t.status)
    )
  );

-- 2) SUBNOTAS: user_can_view_note / user_can_edit_note incluem o DONO da categoria.
--    (As policies de subnota delegam a essas funções; ver fix_subnote_perms_shares.sql.)
create or replace function public.user_can_view_note(target_note_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $fn$
  select exists (
    select 1 from public.notes n
    where n.id = target_note_id
      and (
        n.creator_id = auth.uid()
        or n.creator_id in (select public.notas_visible_creator_ids())
        or (n.task_id is not null and public.notas_category_shared_with_me(n.task_id))
        or (n.task_id is not null and exists (
              select 1 from public.tasks t
              where t.id = n.task_id and public.notas_owns_category_key(t.status)))
      )
  )
  or exists (
    select 1 from public.note_shares ns
    where ns.note_id = target_note_id and ns.shared_with = auth.uid()
  );
$fn$;

create or replace function public.user_can_edit_note(target_note_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $fn$
  select public.notas_can_edit_note(target_note_id)
    or exists (
      select 1 from public.notes n
      where n.id = target_note_id
        and n.creator_id in (select public.notas_editable_creator_ids())
    )
    or exists (
      select 1 from public.notes n
      join public.tasks t on t.id = n.task_id
      where n.id = target_note_id and public.notas_owns_category_key(t.status)
    );
$fn$;

grant execute on function public.user_can_view_note(uuid) to authenticated;
grant execute on function public.user_can_edit_note(uuid) to authenticated;
