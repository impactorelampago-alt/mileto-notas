-- ============================================================================
-- Mileto Notas — (1) Mídias por nota  (2) Aviso de nova nota em categoria compartilhada
-- ----------------------------------------------------------------------------
-- Aditivo e idempotente. Depende de objetos já existentes do Notas:
--   notas_can_edit_note(uuid), notas_notifications (tabela do sino),
--   category_shares(category_key, shared_with). APLICAR notas_notifications.sql ANTES.
-- ============================================================================

-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ 1) note_media — imagens anexadas a uma nota (metadados; arquivo no Storage) ║
-- ╚══════════════════════════════════════════════════════════════════════════╝
create table if not exists public.note_media (
  id           uuid primary key default gen_random_uuid(),
  note_id      uuid not null references public.notes(id) on delete cascade,
  storage_path text not null,                         -- caminho no bucket note-media: <note_id>/<uuid>.<ext>
  mime_type    text not null default 'image/png',
  filename     text,
  created_by   uuid references public.profiles(id) on delete set null,
  created_at   timestamptz not null default now()
);

create index if not exists idx_note_media_note on public.note_media (note_id, created_at);

alter table public.note_media enable row level security;
grant select, insert, delete on public.note_media to authenticated;

-- SELECT: vê a mídia QUEM VÊ A NOTA. A subquery em notes é avaliada SOB a RLS de
-- notes (dono / shared_with / shared_category / dono-lê-tudo) — reaproveita tudo.
drop policy if exists note_media_select on public.note_media;
create policy note_media_select on public.note_media
  for select to authenticated
  using (exists (select 1 from public.notes n where n.id = note_media.note_id));

-- INSERT: só quem PODE EDITAR a nota (dono / EDIT / categoria compartilhada) e
-- gravando como si mesmo (created_by = auth.uid()).
drop policy if exists note_media_insert on public.note_media;
create policy note_media_insert on public.note_media
  for insert to authenticated
  with check (created_by = auth.uid() and public.notas_can_edit_note(note_id));

-- DELETE: quem subiu a mídia OU o dono da nota.
drop policy if exists note_media_delete on public.note_media;
create policy note_media_delete on public.note_media
  for delete to authenticated
  using (
    created_by = auth.uid()
    or exists (select 1 from public.notes n where n.id = note_media.note_id and n.creator_id = auth.uid())
  );

-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ 2) Bucket de Storage privado + policies (espelham o acesso à nota)          ║
-- ╚══════════════════════════════════════════════════════════════════════════╝
-- Caminho do arquivo: <note_id>/<uuid>.<ext> → (storage.foldername(name))[1] = note_id.
-- SVG fica DE FORA de propósito (a cópia pro clipboard rasteriza via canvas e
-- SVG sem dimensões intrínsecas quebra). Só formatos rasterizáveis.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'note-media', 'note-media', false, 26214400,
  array['image/png','image/jpeg','image/gif','image/webp','image/avif']
)
on conflict (id) do nothing;

-- Leitura (necessária p/ signed URLs): quem vê a nota da pasta vê o arquivo.
drop policy if exists "note_media read" on storage.objects;
create policy "note_media read" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'note-media'
    and exists (select 1 from public.notes n where n.id::text = (storage.foldername(name))[1])
  );

-- Upload: só quem pode editar a nota daquela pasta.
drop policy if exists "note_media write" on storage.objects;
create policy "note_media write" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'note-media'
    and (storage.foldername(name))[1] ~ '^[0-9a-fA-F-]{36}$'
    and public.notas_can_edit_note(((storage.foldername(name))[1])::uuid)
  );

-- Remoção: idem upload (editor da nota).
drop policy if exists "note_media remove" on storage.objects;
create policy "note_media remove" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'note-media'
    and (storage.foldername(name))[1] ~ '^[0-9a-fA-F-]{36}$'
    and public.notas_can_edit_note(((storage.foldername(name))[1])::uuid)
  );

-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ 3) Trigger: NOVA nota em categoria COMPARTILHADA → avisa os destinatários   ║
-- ╚══════════════════════════════════════════════════════════════════════════╝
-- Quando uma task é criada com status = key de uma categoria compartilhada,
-- notifica cada `shared_with` (subordinado) — exceto o criador e quem disparou.
-- Best-effort (EXCEPTION) p/ nunca abortar a criação da task.
create or replace function public.notas_notify_on_shared_note()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
begin
  if NEW.status is not null then
    begin
      insert into public.notas_notifications (recipient_id, actor_id, task_id, title, type)
      select cs.shared_with, v_actor, NEW.id, coalesce(NEW.title, ''), 'note_created'
      from public.category_shares cs
      where cs.category_key = NEW.status
        and cs.shared_with is distinct from NEW.creator_id
        and cs.shared_with is distinct from v_actor;
    exception when others then
      null;
    end;
  end if;
  return NEW;
end;
$$;

drop trigger if exists trg_notas_notify_on_shared_note on public.tasks;
create trigger trg_notas_notify_on_shared_note
  after insert on public.tasks
  for each row execute function public.notas_notify_on_shared_note();
