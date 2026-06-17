-- ============================================================================
-- Correções de segurança da AUDITORIA (jun/2026, v1.4.2) — Mileto Notas
-- ----------------------------------------------------------------------------
-- Banco self-hosted supabase.miletoops.com — COMPARTILHADO com o Ops.
-- Tudo CREATE OR REPLACE (idempotente, aditivo). Não altera schema, só corpos de
-- 3 funções já existentes. Registrado no CLAUDE.md (A PASSAR PRO OPS).
--
-- Conserta 3 achados confirmados:
--  B) notas_can_complete_task: destinatário VIEW-only de NOTA não devia "Concluir"
--     (mover task pro DONE no board do Ops). Agora a via de note_shares exige EDIT.
--  E) notas_reopen_task: autorização ASSIMÉTRICA — DONO/assignee/cargo_edit
--     conseguiam concluir mas NÃO reabrir (ficava preso em DONE). Agora simétrica.
--  D) notas_create_note_for: aceitava p_status arbitrário → criar task na coluna de
--     um TERCEIRO (status de um dono, creator de outro). Agora valida que o prefixo
--     da key pertence a p_owner.
-- ============================================================================
BEGIN;

-- ----------------------------------------------------------------------------
-- B) Concluir exige EDIT na via de note_shares (categoria compartilhada = EDIT por
--    design; dono/assignee/DONO seguem podendo). Espelha a regra do reabrir.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.notas_can_complete_task(p_task_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT
    public.notas_is_dono()
    OR EXISTS (SELECT 1 FROM public.tasks t
                 WHERE t.id = p_task_id
                   AND (t.creator_id = auth.uid() OR t.assignee_id = auth.uid()))
    OR public.notas_category_shared_with_me(p_task_id)
    OR EXISTS (SELECT 1 FROM public.note_shares ns
                 JOIN public.notes n ON n.id = ns.note_id
                 WHERE n.task_id = p_task_id
                   AND ns.shared_with = auth.uid()
                   AND ns.permission = 'EDIT');   -- <- antes: sem exigir EDIT
$$;
GRANT EXECUTE ON FUNCTION public.notas_can_complete_task(uuid) TO authenticated;

-- ----------------------------------------------------------------------------
-- E) Reabrir com autorização SIMÉTRICA ao concluir (DONO/assignee/cargo_edit +
--    categoria compartilhada + note_share EDIT). Destino segue restrito ao MESMO
--    dono (anti-escalação de coluna), então ampliar quem pode reabrir é seguro.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.notas_reopen_task(p_task_id uuid, p_target_status text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
declare
  v_cur     text;
  v_creator uuid;
  v_uid     uuid := auth.uid();
  v_target  text := p_target_status;
begin
  select status, creator_id into v_cur, v_creator from public.tasks where id = p_task_id;
  if v_cur is null then
    raise exception 'tarefa não encontrada';
  end if;

  if v_target is null then
    v_target := left(v_cur, 37) || 'TODO';
  end if;

  -- destino deve pertencer ao MESMO dono e existir em custom_statuses
  if left(v_target, 37) <> left(v_cur, 37)
     or not exists (select 1 from public.custom_statuses where key = v_target) then
    raise exception 'status de destino inválido';
  end if;

  -- autorização SIMÉTRICA ao concluir
  if not (
       v_creator = v_uid
       or public.notas_is_dono()
       or exists (select 1 from public.tasks t where t.id = p_task_id and t.assignee_id = v_uid)
       or v_creator in (select public.notas_editable_creator_ids())
       or exists (select 1 from public.category_shares cs
                    where cs.category_key = v_target and cs.shared_with = v_uid)
       or exists (select 1 from public.note_shares ns
                    join public.notes n on n.id = ns.note_id
                    where n.task_id = p_task_id and ns.shared_with = v_uid and ns.permission = 'EDIT')
  ) then
    raise exception 'sem permissão para reabrir esta tarefa';
  end if;

  update public.tasks set status = v_target where id = p_task_id;
end;
$$;
GRANT EXECUTE ON FUNCTION public.notas_reopen_task(uuid, text) TO authenticated;

-- ----------------------------------------------------------------------------
-- D) Criar nota COMO p_owner — validar que p_status é uma coluna DO p_owner.
--    Sem isto, DONO/cargo_edit (ou bug de front) criaria task na coluna de um
--    terceiro: status com prefixo de um dono e creator de outro (polui o board do
--    Ops + dispara notificações de categoria compartilhada alheia).
--    Prefixo canônico = 'USR_' + 32hex + '_' = 37 chars (CLAUDE.md item 5).
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.notas_create_note_for(p_owner uuid, p_status text, p_title text, p_content text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
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
  -- p_status DEVE ser uma coluna do próprio p_owner (prefixo de 37 chars).
  if p_status is null
     or left(p_status, 37) <> 'USR_' || replace(p_owner::text, '-', '') || '_' then
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
REVOKE ALL ON FUNCTION public.notas_create_note_for(uuid,text,text,text) FROM public;
GRANT EXECUTE ON FUNCTION public.notas_create_note_for(uuid,text,text,text) TO authenticated;

COMMIT;

-- ============================================================================
-- NÃO INCLUÍDO DE PROPÓSITO (decisões/risco — ver CLAUDE.md A PASSAR PRO OPS):
--  • notes_select_linked_task (furo de visibilidade por núcleo): mudar a regra é
--    decisão de produto (Opção A: por núcleo / Opção B: igual à task). Tightening
--    sem poder testar no banco arrisca regredir o "notas não carregam". DECIDIR.
--  • category_shares.permission (VIEW/EDIT por categoria): coluna nova; o front só
--    passa a ler DEPOIS de aplicada (senão o select quebra). Ver bloco abaixo.
--  • DROP get_ops_snapshot: função órfã no Notas, mas o OPS pode usá-la — NÃO
--    dropar sem confirmar no Ops.
-- ============================================================================

-- (OPCIONAL — categoria VIEW/EDIT; aplicar SÓ junto com o ajuste de front que lê a
--  coluna, senão nada muda. Aditivo e retrocompatível: default 'EDIT'.)
-- ALTER TABLE public.category_shares
--   ADD COLUMN IF NOT EXISTS permission text NOT NULL DEFAULT 'EDIT'
--   CHECK (permission IN ('VIEW','EDIT'));
