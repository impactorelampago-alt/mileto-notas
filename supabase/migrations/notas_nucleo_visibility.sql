-- ============================================================================
-- Visibilidade por NÚCLEO (permission_settings) — Mileto Notas
-- ----------------------------------------------------------------------------
-- Substitui o "DONO vê tudo" (notas_is_dono) pela árvore de cargos que o DONO
-- configura no Ops (Permissões de Equipe), gravada em public.permission_settings:
--   nucleo_tree       jsonb  -> árvore [{key, children:[...]}]
--   cargo_members     jsonb  -> { cargoKey: [profileId, ...] }
--   cargo_visibility  jsonb  -> { cargoKey: [cargoKeys cujos dados vê] }
--   cargo_edit        jsonb  -> { cargoKey: [cargoKeys que também EDITA] } (subconj.)
--
-- Regra (idêntica ao Ops): o usuário vê as notas das pessoas nos cargos que o
-- cargo DELE "vê os dados de" — pega os cargos da pessoa em cargo_members,
-- expande por cargo_visibility OU (se não setado) pelo default = cargos
-- aninhados ABAIXO na árvore; junta os profileIds. DONO vê/edita tudo.
--
-- IMPORTANTE: a tabela `notes` é exclusiva da Notas (o Ops não lê notes), então
-- mexer na RLS de notes afeta só a Notas. Também fecha o furo `notes_task_select`
-- (qualquer logado lia toda nota com task_id), senão a visibilidade não restringe.
-- ============================================================================

-- 1) Coleta recursiva de TODAS as keys de cargo abaixo de uma lista de nós.
create or replace function public.notas_collect_cargo_keys(p_nodes jsonb)
returns text[] language plpgsql immutable as $$
declare node jsonb; res text[] := '{}';
begin
  if p_nodes is null then return res; end if;
  for node in select value from jsonb_array_elements(p_nodes) loop
    res := res || (node->>'key');
    res := res || public.notas_collect_cargo_keys(node->'children');
  end loop;
  return res;
end $$;

-- 2) Descendentes de um cargo na árvore (default de visibilidade quando o cargo
--    não tem entrada em cargo_visibility). Folhas retornam {} (só veem o próprio).
create or replace function public.notas_cargo_descendants(p_tree jsonb, p_cargo text)
returns text[] language plpgsql immutable as $$
declare node jsonb; res text[] := '{}';
begin
  if p_tree is null then return res; end if;
  for node in select value from jsonb_array_elements(p_tree) loop
    if node->>'key' = p_cargo then
      return public.notas_collect_cargo_keys(node->'children');
    end if;
    res := public.notas_cargo_descendants(node->'children', p_cargo);
    if array_length(res,1) > 0 then return res; end if;
  end loop;
  return res;
end $$;

-- 3) profile_ids que o usuário ATUAL pode VER (próprio + cargos visíveis).
create or replace function public.notas_visible_creator_ids()
returns setof uuid language plpgsql stable security definer set search_path=public as $$
declare
  uid uuid := auth.uid();
  ps record;
  my_cargos text[];
  visible_cargos text[] := '{}';
  c text;
  vis jsonb;
begin
  if uid is null then return; end if;
  return next uid;                          -- sempre vê o PRÓPRIO
  if exists (select 1 from profiles where id = uid and role = 'DONO') then
    return query select id from profiles where id <> uid;   -- DONO vê todos
    return;
  end if;
  select * into ps from permission_settings order by id limit 1;
  if not found then return; end if;
  -- cargos do usuário (chaves de cargo_members cujo array contém o uid)
  select coalesce(array_agg(key), '{}') into my_cargos
    from jsonb_each(ps.cargo_members) e(key, val)
    where jsonb_typeof(val) = 'array' and val ? uid::text;
  if my_cargos is null or array_length(my_cargos,1) is null then return; end if;
  -- cargos visíveis (cargo_visibility OU default = descendentes na árvore)
  foreach c in array my_cargos loop
    vis := ps.cargo_visibility -> c;
    if vis is not null and jsonb_typeof(vis) = 'array' then
      visible_cargos := visible_cargos || array(select jsonb_array_elements_text(vis));
    else
      visible_cargos := visible_cargos || public.notas_cargo_descendants(ps.nucleo_tree, c);
    end if;
  end loop;
  if array_length(visible_cargos,1) is null then return; end if;
  return query
    select distinct (jsonb_array_elements_text(ps.cargo_members -> vc))::uuid
      from unnest(visible_cargos) vc
     where ps.cargo_members ? vc and jsonb_typeof(ps.cargo_members -> vc) = 'array';
end $$;

revoke all on function public.notas_visible_creator_ids() from public;
grant execute on function public.notas_visible_creator_ids() to authenticated;

-- 4) profile_ids que o usuário ATUAL pode EDITAR (próprio + cargo_edit). cargo_edit
--    vazio => só o próprio (edição extra vem de category_shares/note_shares EDIT).
create or replace function public.notas_editable_creator_ids()
returns setof uuid language plpgsql stable security definer set search_path=public as $$
declare uid uuid := auth.uid(); ps record; my_cargos text[]; edit_cargos text[] := '{}'; c text; ed jsonb;
begin
  if uid is null then return; end if;
  return next uid;
  if exists (select 1 from profiles where id = uid and role = 'DONO') then
    return query select id from profiles where id <> uid;
    return;
  end if;
  select * into ps from permission_settings order by id limit 1;
  if not found then return; end if;
  select coalesce(array_agg(key), '{}') into my_cargos
    from jsonb_each(ps.cargo_members) e(key, val)
    where jsonb_typeof(val) = 'array' and val ? uid::text;
  if my_cargos is null or array_length(my_cargos,1) is null then return; end if;
  foreach c in array my_cargos loop
    ed := ps.cargo_edit -> c;
    if ed is not null and jsonb_typeof(ed) = 'array' then
      edit_cargos := edit_cargos || array(select jsonb_array_elements_text(ed));
    end if;
  end loop;
  if array_length(edit_cargos,1) is null then return; end if;
  return query
    select distinct (jsonb_array_elements_text(ps.cargo_members -> vc))::uuid
      from unnest(edit_cargos) vc
     where ps.cargo_members ? vc and jsonb_typeof(ps.cargo_members -> vc) = 'array';
end $$;

revoke all on function public.notas_editable_creator_ids() from public;
grant execute on function public.notas_editable_creator_ids() to authenticated;

-- 5) SELECT de notes por núcleo + FECHAR o furo de leitura aberta.
drop policy if exists notes_select_dono_reads_all on public.notes;  -- "dono vê tudo" -> núcleo
drop policy if exists notes_task_select on public.notes;            -- FURO: qualquer logado lia toda nota
create policy notes_select_nucleo on public.notes for select to authenticated
  using ( creator_id = auth.uid()
          or creator_id in (select public.notas_visible_creator_ids()) );

-- 6) UPDATE de notes pelo núcleo (cargo_edit). Mantém as policies de
--    creator/shared existentes; esta apenas ADICIONA edição por cargo_edit.
create policy notes_update_nucleo on public.notes for update to authenticated
  using ( creator_id in (select public.notas_editable_creator_ids()) )
  with check ( creator_id in (select public.notas_editable_creator_ids()) );
