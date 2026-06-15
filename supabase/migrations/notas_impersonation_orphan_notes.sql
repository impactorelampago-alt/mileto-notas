-- ============================================================================
-- Impersonação completa — notas órfãs do usuário visualizado (jun/2026, v1.4.0)
-- ----------------------------------------------------------------------------
-- Ao impersonar (ver a conta de outra pessoa), a Notas não conseguia mostrar as
-- TAREFAS sem nota (criadas direto no Ops), porque o insert direto amarra
-- `notes.creator_id` ao usuário LOGADO (RLS), não ao visualizado — então o
-- ensureNotesForOrphanTasks era simplesmente pulado em impersonação.
--
-- Este RPC (SECURITY DEFINER) cria as notas que faltam de um `p_owner`, com
-- `creator = p_owner`, SE o chamador pode VER p_owner (próprio, DONO, ou núcleo
-- via notas_visible_creator_ids). Quem VÊ/EDITA já é decidido por
-- notas_visible_creator_ids / notas_editable_creator_ids (ver
-- notas_nucleo_visibility.sql) + RLS notes_select_nucleo / notes_update_nucleo.
--
-- É objeto SÓ da Notas (cria `notes`, que o Ops não usa) — sem impacto no Ops.
-- ============================================================================

create or replace function public.notas_create_missing_notes_for(p_owner uuid)
returns integer language plpgsql security definer set search_path=public as $$
declare n integer := 0;
begin
  if p_owner is null then return 0; end if;
  -- Só permite se o chamador pode VER p_owner (próprio, DONO, ou núcleo).
  if not (
    p_owner = auth.uid()
    or exists (select 1 from profiles where id = auth.uid() and role = 'DONO')
    or p_owner in (select public.notas_visible_creator_ids())
  ) then
    return 0;
  end if;
  insert into public.notes (title, content, priority, creator_id, task_id, is_pinned, is_archived)
  select coalesce(nullif(t.title, ''), 'Sem titulo'),
         coalesce(t.description, ''),
         coalesce(t.priority::text, 'LOW'),
         p_owner, t.id, false, false
    from public.tasks t
   where (t.status like 'USR_' || replace(p_owner::text, '-', '') || '_%' or t.assignee_id = p_owner)
     and not exists (select 1 from public.notes n where n.task_id = t.id)
  on conflict (task_id) do nothing;
  get diagnostics n = row_count;
  return n;
end $$;

revoke all on function public.notas_create_missing_notes_for(uuid) from public;
grant execute on function public.notas_create_missing_notes_for(uuid) to authenticated;
