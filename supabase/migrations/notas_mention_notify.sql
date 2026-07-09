-- ============================================================================
-- Mileto Notas — Notificação de @menção
-- ----------------------------------------------------------------------------
-- RPC SECURITY DEFINER que grava 1 notificação (type='mention') quando alguém
-- menciona outra pessoa no texto de uma nota. Necessário porque a tabela
-- notas_notifications NÃO tem policy de INSERT para authenticated (anti-forja) —
-- inserções só por função SECURITY DEFINER.
--
-- Regras:
--  - o CHAMADOR precisa poder VER a nota (anti-forja).
--  - só notifica se o DESTINATÁRIO tem acesso à nota (criador / DONO / note_shares
--    / category_shares). Se não tem → retorna 'no_access' e o front avisa quem
--    mencionou + oferece compartilhar (decisão (a)+(c)).
--  - dedup: não duplica menção NÃO LIDA pra (destinatário, nota).
--  - nunca notifica a si mesmo.
--
-- Aditivo/idempotente. Não altera nada pré-existente. type='mention' reusa a
-- tabela notas_notifications (campo type já é texto livre) — sem mudar schema.
-- Reserva de nome: notas_notify_mention é do Notas; o Ops não recria/derruba.
-- ============================================================================

create or replace function public.notas_notify_mention(
  p_note_id uuid,
  p_recipient uuid,
  p_title text
)
returns text  -- 'ok' | 'no_access' | 'skip'
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor   uuid := auth.uid();
  v_task_id uuid;
  v_creator uuid;
  v_role    text;
  v_access  boolean;
begin
  if v_actor is null or p_recipient is null or p_note_id is null then return 'skip'; end if;
  if p_recipient = v_actor then return 'skip'; end if;

  select task_id, creator_id into v_task_id, v_creator
  from public.notes where id = p_note_id;
  if not found then return 'skip'; end if;

  -- o CHAMADOR precisa poder ver a nota (anti-forja)
  if not public.user_can_view_note(p_note_id) then return 'skip'; end if;

  -- o DESTINATÁRIO tem acesso? (criador / DONO / note_shares / category_shares)
  select role::text into v_role from public.profiles where id = p_recipient;
  -- coalesce nos ramos que podem dar NULL (v_creator/v_role nulos) — senão a cadeia
  -- OR vira NULL e o "if not v_access" não pega o caso sem-acesso.
  v_access :=
       coalesce(v_creator = p_recipient, false)
    or coalesce(v_role = 'DONO', false)
    or exists (select 1 from public.note_shares ns
                 where ns.note_id = p_note_id and ns.shared_with = p_recipient)
    or (v_task_id is not null and exists (
          select 1 from public.tasks t
            join public.category_shares cs on cs.category_key = t.status
           where t.id = v_task_id and cs.shared_with = p_recipient));
  if not v_access then return 'no_access'; end if;

  -- dedup: já existe menção NÃO LIDA pra (destinatário, nota)?
  if exists (
    select 1 from public.notas_notifications
     where recipient_id = p_recipient and note_id = p_note_id
       and type = 'mention' and read_at is null
  ) then
    return 'ok';
  end if;

  begin
    insert into public.notas_notifications (recipient_id, actor_id, task_id, note_id, title, type)
    values (p_recipient, v_actor, v_task_id, p_note_id, coalesce(p_title, ''), 'mention');
  exception when others then
    return 'skip';
  end;
  return 'ok';
end;
$$;

grant execute on function public.notas_notify_mention(uuid, uuid, text) to authenticated;
