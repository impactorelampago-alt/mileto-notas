-- ============================================================================
-- Impersonação: escrita COMO o usuário visualizado + exclusão por permissão
-- (jun/2026, v1.4.1) — Mileto Notas
-- ----------------------------------------------------------------------------
-- A RLS amarra a criação ao usuário LOGADO (notes/tasks com creator = auth.uid()).
-- Logo, ao impersonar (ver a conta de outro), criar uma nota a criava na SUA conta
-- (sumia na dele) e o título/texto se perdiam na troca de visão. E apagar nota de
-- terceiro era bloqueado (só o criador apaga).
--
-- Estes 2 RPCs (SECURITY DEFINER) agem COMO a pessoa visualizada, validando no
-- banco que o chamador pode EDITÁ-la (próprio, DONO, ou cargo com EDITAR via
-- notas_editable_creator_ids — ver notas_nucleo_visibility.sql). Criam/apagam
-- `notes`+`tasks` (tabelas do banco compartilhado; `notes` é só da Notas).
--
-- ⚠️ BANCO COMPARTILHADO COM O OPS — registrado no CLAUDE.md (A PASSAR PRO OPS).
-- ============================================================================

-- 1) Criar nota COMO p_owner (tarefa + nota com creator = p_owner).
create or replace function public.notas_create_note_for(p_owner uuid, p_status text, p_title text, p_content text)
returns uuid language plpgsql security definer set search_path=public as $$
declare v_task uuid; v_note uuid;
begin
  if p_owner is null then return null; end if;
  if not (
    p_owner = auth.uid()
    or exists (select 1 from profiles where id = auth.uid() and role = 'DONO')
    or p_owner in (select public.notas_editable_creator_ids())
  ) then
    return null;
  end if;
  insert into public.tasks (title, status, priority, position, assignee_id, creator_id, is_template)
  values (coalesce(nullif(p_title,''),'Sem titulo'), p_status, 'LOW'::task_priority, 0, p_owner, p_owner, false)
  returning id into v_task;
  insert into public.notes (title, content, priority, creator_id, task_id, is_pinned, is_archived)
  values (coalesce(nullif(p_title,''),'Sem titulo'), coalesce(p_content,''), 'LOW', p_owner, v_task, false, false)
  returning id into v_note;
  return v_note;
end $$;

revoke all on function public.notas_create_note_for(uuid,text,text,text) from public;
grant execute on function public.notas_create_note_for(uuid,text,text,text) to authenticated;

-- 2) Apagar nota + tarefa, se o chamador pode EDITAR o criador dela.
create or replace function public.notas_delete_note_for(p_note_id uuid)
returns boolean language plpgsql security definer set search_path=public as $$
declare v_creator uuid; v_task uuid;
begin
  select creator_id, task_id into v_creator, v_task from notes where id = p_note_id;
  if v_creator is null then return false; end if;
  if not (
    v_creator = auth.uid()
    or exists (select 1 from profiles where id = auth.uid() and role = 'DONO')
    or v_creator in (select public.notas_editable_creator_ids())
  ) then
    return false;
  end if;
  delete from public.notes where id = p_note_id;
  if v_task is not null then delete from public.tasks where id = v_task; end if;
  return true;
end $$;

revoke all on function public.notas_delete_note_for(uuid) from public;
grant execute on function public.notas_delete_note_for(uuid) to authenticated;

-- NOTA (front, só Notas, sem SQL): além dos RPCs, o sync nota↔task ganhou uma
-- PROTEÇÃO ANTI-APAGAMENTO — uma `tasks.description` VAZIA nunca apaga o conteúdo
-- de uma nota que tem texto (o clock-skew fazia o "task é mais novo" dar true
-- sempre e apagar o que o usuário tinha acabado de digitar, principalmente em
-- categoria compartilhada). E `canDeleteNote` passou a liberar DONO + cargo_edit.
