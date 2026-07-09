-- ============================================================================
-- Mileto Notas — Editar/Excluir/Mídia/Menção em notas de OUTROS: dono-da-categoria,
-- subnota e núcleo (v1.4.31)
-- ----------------------------------------------------------------------------
-- Sintoma (reportado): numa categoria compartilhada, quando A cria uma nota/subnota,
-- os OUTROS (dono da categoria, destinatários) não conseguem EXCLUIR nem PÔR MÍDIA;
-- e a @menção de quem tem acesso (mas não criou) cai em "sem acesso".
--
-- Raiz: as funções-BASE de permissão não cobriam 2 casos que o item 24 (v1.4.24) já
-- havia coberto em user_can_view_note/user_can_edit_note, mas NÃO na função-base
-- notas_can_edit_note nem nos RPCs de excluir/mencionar:
--   (i)  DONO da categoria (nota que OUTRO criou numa categoria SUA);
--   (ii) SUBNOTA (task_id = NULL → o acesso é herdado da nota-raiz, mas as checagens
--        olhavam a própria linha e o ramo de categoria morria no NULL).
--
-- Mídia (note_media INSERT + Storage write/remove) e o RPC de excluir dependem de
-- notas_can_edit_note; a menção reimplementava o check. Este migration:
--   1) notas_root_task_id(note)  — sobe por parent_note_id até a task da nota-raiz.
--   2) notas_can_edit_note       — passa a cobrir dono-da-categoria + subnota (via 1).
--   3) notas_delete_note_for     — guard alargado p/ "quem pode editar" (decisão do
--                                  usuário: dono da categoria + destinatários EDIT).
--                                  ⚠️ apagar a nota-raiz apaga a task = tira o card do
--                                  board do Ops (mesma tabela tasks).
--   4) notas_visible_creator_ids_for(user) — versão parametrizada (p/ checar a
--      visibilidade de NÚCLEO de um destinatário arbitrário, não só auth.uid()).
--   5) notas_note_visible_to(note, user)   — "esse usuário consegue VER a nota?"
--      (criador/DONO/núcleo/note_share/dono-da-categoria/destinatário, subnota-aware).
--   6) notas_notify_mention      — usa (5) nos 2 lados (anti-forja + destinatário) →
--      notifica QUALQUER um que consiga ver a nota (inclui núcleo). Decisão do usuário.
--
-- Aditivo/idempotente. Só toca objetos DO NOTAS (funções notas_*/user_can_* e o RPC).
-- Reserva de nomes: notas_* / user_can_*_note são do Notas; o Ops não recria/derruba.
-- ⚠️ BANCO COMPARTILHADO — registrado no CLAUDE.md (A PASSAR PRO OPS).
-- ============================================================================

-- 1) task "efetiva" de uma nota: sobe por parent_note_id até a raiz que tem task.
--    (subnota herda a categoria da nota-raiz). Guard de profundidade contra ciclo.
create or replace function public.notas_root_task_id(p_note_id uuid)
returns uuid
language sql stable security definer set search_path = public, pg_temp
as $$
  with recursive chain as (
    select id, parent_note_id, task_id, 1 as depth
      from public.notes where id = p_note_id
    union all
    select n.id, n.parent_note_id, n.task_id, c.depth + 1
      from public.notes n
      join chain c on n.id = c.parent_note_id
     where c.task_id is null and c.depth < 20
  )
  select task_id from chain where task_id is not null limit 1;
$$;
revoke all on function public.notas_root_task_id(uuid) from public;
grant execute on function public.notas_root_task_id(uuid) to authenticated;

-- 1b) id da nota-RAIZ (topo da cadeia de parent_note_id). Usado pra propagar o
--     acesso via note_shares da raiz p/ as subnotas (subnota herda o share da raiz).
create or replace function public.notas_root_note_id(p_note_id uuid)
returns uuid
language sql stable security definer set search_path = public, pg_temp
as $$
  with recursive chain as (
    select id, parent_note_id, 1 as depth
      from public.notes where id = p_note_id
    union all
    select n.id, n.parent_note_id, c.depth + 1
      from public.notes n
      join chain c on n.id = c.parent_note_id
     where c.parent_note_id is not null and c.depth < 20
  )
  select id from chain order by depth desc limit 1;
$$;
revoke all on function public.notas_root_note_id(uuid) from public;
grant execute on function public.notas_root_note_id(uuid) to authenticated;

-- 2) notas_can_edit_note: + dono-da-categoria + subnota (via notas_root_task_id).
--    Mantém criador + note_share EDIT + destinatário de category_shares.
--    Para nota-raiz o comportamento é IDÊNTICO ao anterior (root_task = a própria task).
create or replace function public.notas_can_edit_note(p_note_id uuid)
returns boolean
language sql stable security definer set search_path = public, pg_temp
as $$
  select
    exists (select 1 from public.notes n
              where n.id = p_note_id and n.creator_id = auth.uid())
    or exists (select 1 from public.note_shares ns
                 where ns.note_id = p_note_id
                   and ns.shared_with = auth.uid()
                   and ns.permission = 'EDIT')
    or coalesce((
         select public.notas_category_shared_with_me(rt)
             or exists (select 1 from public.tasks t
                          where t.id = rt and public.notas_owns_category_key(t.status))
         from (select public.notas_root_task_id(p_note_id) as rt) s
         where s.rt is not null
       ), false);
$$;

-- 3) notas_delete_note_for: alarga o guard p/ "quem pode editar" (user_can_edit_note,
--    que agora cobre dono-da-categoria + subnota + destinatário EDIT + núcleo-edit).
create or replace function public.notas_delete_note_for(p_note_id uuid)
returns boolean
language plpgsql security definer set search_path = public
as $$
declare v_creator uuid; v_task uuid;
begin
  select creator_id, task_id into v_creator, v_task from notes where id = p_note_id;
  if v_creator is null then return false; end if;
  if not (
    v_creator = auth.uid()
    or exists (select 1 from profiles where id = auth.uid() and role = 'DONO')
    or v_creator in (select public.notas_editable_creator_ids())
    or public.user_can_edit_note(p_note_id)
  ) then
    return false;
  end if;
  delete from public.notes where id = p_note_id;
  if v_task is not null then delete from public.tasks where id = v_task; end if;
  return true;
end $$;
revoke all on function public.notas_delete_note_for(uuid) from public;
grant execute on function public.notas_delete_note_for(uuid) to authenticated;

-- 4) visibilidade de NÚCLEO parametrizada por usuário (espelha notas_visible_creator_ids,
--    trocando auth.uid() por p_user). SÓ p/ uso interno (SECURITY DEFINER) — sem grant
--    a authenticated (evita vazar a estrutura de quem-vê-quem).
create or replace function public.notas_visible_creator_ids_for(p_user uuid)
returns setof uuid
language plpgsql stable security definer set search_path = public
as $$
declare ps record; my_cargos text[]; visible_cargos text[] := '{}'; c text; vis jsonb;
begin
  if p_user is null then return; end if;
  return next p_user;
  if exists (select 1 from profiles where id = p_user and role = 'DONO') then
    return query select id from profiles where id <> p_user; return;
  end if;
  select * into ps from permission_settings order by id limit 1;
  if not found then return; end if;
  select coalesce(array_agg(key), '{}') into my_cargos
    from jsonb_each(ps.cargo_members) e(key, val)
    where jsonb_typeof(val) = 'array' and val ? p_user::text;
  if my_cargos is null or array_length(my_cargos, 1) is null then return; end if;
  foreach c in array my_cargos loop
    vis := ps.cargo_visibility -> c;
    if vis is not null and jsonb_typeof(vis) = 'array' then
      visible_cargos := visible_cargos || array(select jsonb_array_elements_text(vis));
    else
      visible_cargos := visible_cargos || public.notas_cargo_descendants(ps.nucleo_tree, c);
    end if;
  end loop;
  if array_length(visible_cargos, 1) is null then return; end if;
  return query select distinct (jsonb_array_elements_text(ps.cargo_members -> vc))::uuid
    from unnest(visible_cargos) vc
    where ps.cargo_members ? vc and jsonb_typeof(ps.cargo_members -> vc) = 'array';
end $$;
revoke all on function public.notas_visible_creator_ids_for(uuid) from public;

-- 5) "p_user consegue VER a nota?" — criador / DONO / núcleo / note_share /
--    dono-da-categoria / destinatário-de-categoria; subnota-aware (via root_task).
create or replace function public.notas_note_visible_to(p_note_id uuid, p_user uuid)
returns boolean
language sql stable security definer set search_path = public, pg_temp
as $$
  select
    exists (
      select 1 from public.notes n
      where n.id = p_note_id
        and (
          n.creator_id = p_user
          or exists (select 1 from public.profiles pr where pr.id = p_user and pr.role = 'DONO')
          or n.creator_id in (select public.notas_visible_creator_ids_for(p_user))
          or coalesce((
               select exists (select 1 from public.tasks t
                                join public.category_shares cs on cs.category_key = t.status
                                where t.id = rt and cs.shared_with = p_user)
                   or exists (select 1 from public.tasks t
                                where t.id = rt
                                  and t.status like ('USR_' || replace(p_user::text, '-', '') || '_%'))
               from (select public.notas_root_task_id(n.id) as rt) s
               where s.rt is not null
             ), false)
        )
    )
    -- note_share direto NA nota OU na nota-RAIZ (subnota herda o share da raiz —
    -- fiel à policy de subnota user_can_view_note(parent)).
    or exists (select 1 from public.note_shares ns
                 where ns.note_id in (p_note_id, public.notas_root_note_id(p_note_id))
                   and ns.shared_with = p_user);
$$;
revoke all on function public.notas_note_visible_to(uuid, uuid) from public;

-- 6) notas_notify_mention: usa notas_note_visible_to nos 2 lados. Notifica qualquer
--    um que consiga ver a nota (inclui núcleo/dono-da-categoria/subnota).
create or replace function public.notas_notify_mention(p_note_id uuid, p_recipient uuid, p_title text)
returns text
language plpgsql security definer set search_path = public
as $$
declare
  v_actor   uuid := auth.uid();
  v_task_id uuid;
begin
  if v_actor is null or p_recipient is null or p_note_id is null then return 'skip'; end if;
  if p_recipient = v_actor then return 'skip'; end if;

  select task_id into v_task_id from public.notes where id = p_note_id;
  if not found then return 'skip'; end if;

  -- anti-forja: o CHAMADOR precisa poder ver a nota
  if not public.notas_note_visible_to(p_note_id, v_actor) then return 'skip'; end if;
  -- o DESTINATÁRIO precisa poder ver a nota
  if not public.notas_note_visible_to(p_note_id, p_recipient) then return 'no_access'; end if;

  -- dedup: menção NÃO LIDA já existente pra (destinatário, nota)
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
end $$;
grant execute on function public.notas_notify_mention(uuid, uuid, text) to authenticated;

-- 7+8) MÍDIA segue o predicado CANÔNICO de edição — public.user_can_edit_note — e não
--    a função-base notas_can_edit_note. Motivo (achado da revisão adversarial): o front
--    mostra os controles de mídia p/ quem canEditNote (que inclui o editor de NÚCLEO /
--    cargo_edit via notas_editable_creator_ids), mas as policies de mídia usavam
--    notas_can_edit_note (SEM esse ramo) → o botão aparecia e o upload/exclusão falhava
--    calado. user_can_edit_note = notas_can_edit_note + editableIds + dono-da-categoria,
--    ou seja, EXATAMENTE quem pode editar o texto da nota. (Hoje cargo_edit está vazio,
--    então isto é aditivo/dormant; evita o bug quando o núcleo for configurado.)
drop policy if exists note_media_insert on public.note_media;
create policy note_media_insert on public.note_media
  for insert to authenticated
  with check (created_by = auth.uid() and public.user_can_edit_note(note_id));

drop policy if exists note_media_delete on public.note_media;
create policy note_media_delete on public.note_media
  for delete to authenticated
  using (
    created_by = auth.uid()
    or public.user_can_edit_note(note_id)
  );

-- Storage (bucket note-media): upload/remoção seguem o mesmo predicado.
drop policy if exists "note_media write" on storage.objects;
create policy "note_media write" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'note-media'
    and (storage.foldername(name))[1] ~ '^[0-9a-fA-F-]{36}$'
    and public.user_can_edit_note(((storage.foldername(name))[1])::uuid)
  );

drop policy if exists "note_media remove" on storage.objects;
create policy "note_media remove" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'note-media'
    and (storage.foldername(name))[1] ~ '^[0-9a-fA-F-]{36}$'
    and public.user_can_edit_note(((storage.foldername(name))[1])::uuid)
  );
