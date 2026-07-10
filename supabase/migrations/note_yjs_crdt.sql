-- ============================================================================
-- Mileto Notas — Co-edição em tempo real (CRDT/Yjs) — Fase 2
-- ----------------------------------------------------------------------------
-- Guarda o ESTADO do documento CRDT (Yjs) de cada nota, pra os clientes convergirem
-- no MESMO doc (o merge de verdade acontece no Yjs; a sync ao vivo é por Realtime
-- Broadcast). O `notes.content` (= `tasks.description`) CONTINUA sendo o markdown
-- (snapshot periódico do doc Yjs) → a integração com o Ops NÃO muda.
--
-- `state` = base64 de Y.encodeStateAsUpdate(doc) (texto, não bytea — trivial via REST).
-- RLS espelha o acesso à nota: quem VÊ lê o estado; quem EDITA grava. Subnota-aware
-- (user_can_view/edit_note já sobem por parent_note_id). NÃO entra na publication de
-- realtime (a sync é por broadcast; a tabela é só persistência / carregar ao abrir).
--
-- ⚠️ BANCO COMPARTILHADO COM O OPS — reserva de nome `note_yjs`. Aditivo/idempotente.
-- Incluir no model Drizzle do Ops pra um drizzle-kit push NÃO propor DROP (mesma
-- armadilha das subnotas/note_edits). O Ops não lê/escreve nesta tabela.
-- ============================================================================

create table if not exists public.note_yjs (
  note_id    uuid primary key references public.notes(id) on delete cascade,
  state      text not null,                 -- base64(Y.encodeStateAsUpdate(doc))
  updated_at timestamptz not null default now()
);

alter table public.note_yjs enable row level security;
grant select, insert, update, delete on public.note_yjs to authenticated;

-- SELECT: quem VÊ a nota lê o estado CRDT.
drop policy if exists note_yjs_select on public.note_yjs;
create policy note_yjs_select on public.note_yjs
  for select to authenticated
  using (public.user_can_view_note(note_id));

-- INSERT: quem PODE EDITAR a nota (grava como estado inicial / snapshot).
drop policy if exists note_yjs_insert on public.note_yjs;
create policy note_yjs_insert on public.note_yjs
  for insert to authenticated
  with check (public.user_can_edit_note(note_id));

-- UPDATE: quem PODE EDITAR a nota.
drop policy if exists note_yjs_update on public.note_yjs;
create policy note_yjs_update on public.note_yjs
  for update to authenticated
  using (public.user_can_edit_note(note_id))
  with check (public.user_can_edit_note(note_id));

-- DELETE: quem PODE EDITAR (o cascade da nota já cobre o comum).
drop policy if exists note_yjs_delete on public.note_yjs;
create policy note_yjs_delete on public.note_yjs
  for delete to authenticated
  using (public.user_can_edit_note(note_id));
