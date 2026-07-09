-- ============================================================================
-- Mileto Notas — Histórico de edição ("quem escreveu, quando")
-- ----------------------------------------------------------------------------
-- Tabela SÓ do Notas: registra QUEM editou cada nota e QUANDO. A nota só tinha
-- updated_at (sem autor). Grava só edições feitas NO NOTAS (o sync task->nota
-- vindo do Ops NÃO é registrado — não é edição de usuário).
--
-- Coalescido: edições rápidas do mesmo usuário na mesma nota (janela de 10 min)
-- viram UMA linha (atualiza edited_at) — evita spam a cada save. Insert só via
-- RPC SECURITY DEFINER (valida user_can_edit_note; editor_id = auth.uid()).
--
-- Reserva de nome: note_edits / notas_record_note_edit são do Notas. O Ops não
-- recria/derruba. ⚠️ Ao rodar drizzle-kit push no Ops, incluir esta tabela no
-- schema pra o push não propor DROP (ver docs/SYNC-NOTAS.md).
-- ============================================================================

create table if not exists public.note_edits (
  id         uuid primary key default gen_random_uuid(),
  note_id    uuid not null references public.notes(id) on delete cascade,
  editor_id  uuid references public.profiles(id) on delete set null,
  edited_at  timestamptz not null default now()
);

create index if not exists idx_note_edits_note
  on public.note_edits (note_id, edited_at desc);

alter table public.note_edits enable row level security;

-- Quem PODE VER a nota vê o histórico dela (reusa user_can_view_note — já cobre
-- criador/núcleo/compartilhada/dono-da-categoria).
drop policy if exists note_edits_select on public.note_edits;
create policy note_edits_select on public.note_edits
  for select using (public.user_can_view_note(note_id));

-- SEM policy de INSERT/UPDATE para authenticated: só via RPC SECURITY DEFINER.
grant select on public.note_edits to authenticated;

create or replace function public.notas_record_note_edit(p_note_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid    uuid := auth.uid();
  v_recent uuid;
begin
  if v_uid is null or p_note_id is null then return; end if;
  if not public.user_can_edit_note(p_note_id) then return; end if;

  -- coalesce: se já editei esta nota nos últimos 10 min, só atualiza o horário.
  select id into v_recent
    from public.note_edits
   where note_id = p_note_id and editor_id = v_uid
     and edited_at > now() - interval '10 minutes'
   order by edited_at desc
   limit 1;

  if v_recent is not null then
    update public.note_edits set edited_at = now() where id = v_recent;
  else
    insert into public.note_edits (note_id, editor_id) values (p_note_id, v_uid);
  end if;
exception when others then
  null; -- best-effort: nunca quebra o save
end;
$$;

grant execute on function public.notas_record_note_edit(uuid) to authenticated;
