-- ============================================================================
-- Mileto Notas — Sino de notificações de "tarefa concluída"
-- ----------------------------------------------------------------------------
-- Objeto SÓ do Notas (prefixo notas_), independente do sistema de notificações
-- do Mileto Ops. Serve EXCLUSIVAMENTE para avisar o CRIADOR de uma tarefa quando
-- OUTRA pessoa (ex.: subordinado numa categoria compartilhada) a conclui.
--
-- Estratégia: TRIGGER aditivo em public.tasks (AFTER UPDATE OF status). Quando o
-- status muda para um key de DONE (sufixo _DONE) e quem fez (auth.uid()) NÃO é o
-- criador, grava 1 notificação para o criador. O insert é envolvido em
-- EXCEPTION para NUNCA abortar o UPDATE da task (segurança no banco compartilhado).
-- Captura conclusões feitas tanto pelo Notas quanto pelo Ops.
--
-- Tudo idempotente (IF NOT EXISTS / OR REPLACE / DROP IF EXISTS). Aditivo: não
-- altera nada pré-existente do Ops.
-- ============================================================================

-- 1) Tabela de notificações ---------------------------------------------------
create table if not exists public.notas_notifications (
  id            uuid primary key default gen_random_uuid(),
  recipient_id  uuid not null references public.profiles(id) on delete cascade,
  actor_id      uuid references public.profiles(id) on delete set null,
  task_id       uuid,            -- sem FK: a task pode ser deletada depois
  note_id       uuid,            -- idem
  title         text not null default '',   -- snapshot do título concluído
  type          text not null default 'task_completed',
  created_at    timestamptz not null default now(),
  read_at       timestamptz
);

create index if not exists idx_notas_notif_recipient
  on public.notas_notifications (recipient_id, read_at, created_at desc);

-- 2) RLS ----------------------------------------------------------------------
alter table public.notas_notifications enable row level security;

-- Destinatário lê só as próprias.
drop policy if exists notas_notif_select_own on public.notas_notifications;
create policy notas_notif_select_own on public.notas_notifications
  for select using (auth.uid() = recipient_id);

-- Destinatário marca como lida só as próprias (e não pode forjar recipient).
drop policy if exists notas_notif_update_own on public.notas_notifications;
create policy notas_notif_update_own on public.notas_notifications
  for update using (auth.uid() = recipient_id)
  with check (auth.uid() = recipient_id);

-- SEM policy de INSERT para authenticated: inserções só via trigger
-- SECURITY DEFINER (que roda como dono e ignora RLS). Impede forjar notificação.

grant select, update on public.notas_notifications to authenticated;

-- 3) Função do trigger --------------------------------------------------------
create or replace function public.notas_notify_on_complete()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
begin
  -- Só quando o status TRANSICIONA para o key DONE CANÔNICO do dono
  -- (USR_<id32>_DONE, prefixo de 37 + 'DONE') — identidade estrita, igual à RPC
  -- notas_complete_task. NÃO casa sufixos custom terminados em DONE (NOT_DONE etc.).
  -- E quem concluiu não é o próprio criador (não notifica a si mesmo).
  if (NEW.status is distinct from OLD.status)
     and NEW.status like 'USR\_%' and length(NEW.status) >= 37
     and NEW.status = left(NEW.status, 37) || 'DONE'
     and (OLD.status is null
          or not (OLD.status like 'USR\_%' and length(OLD.status) >= 37
                  and OLD.status = left(OLD.status, 37) || 'DONE'))
     and NEW.creator_id is not null
     and v_actor is distinct from NEW.creator_id
  then
    -- Best-effort: jamais quebrar o UPDATE da task por causa da notificação.
    begin
      insert into public.notas_notifications (recipient_id, actor_id, task_id, title, type)
      values (NEW.creator_id, v_actor, NEW.id, coalesce(NEW.title, ''), 'task_completed');
    exception when others then
      -- engole qualquer erro (FK, etc.) — a conclusão da task segue normal.
      null;
    end;
  end if;
  return NEW;
end;
$$;

-- 4) Trigger -----------------------------------------------------------------
drop trigger if exists trg_notas_notify_on_complete on public.tasks;
create trigger trg_notas_notify_on_complete
  after update of status on public.tasks
  for each row execute function public.notas_notify_on_complete();

-- 4.b) RPC notas_reopen_task — REABRIR (desfazer concluir) -------------------
-- Espelha o concluir (notas_complete_task): SECURITY DEFINER, valida acesso e
-- move o status DE VOLTA. Necessária porque, depois de concluída, a categoria
-- compartilhada de origem não está mais em tasks.status (foi pro DONE), então um
-- PATCH direto do colaborador afeta 0 linhas (RLS) e "mente" sucesso.
-- p_target_status: key de destino (a origem guardada no front). Se null, usa o
-- TODO do MESMO dono. Em qualquer caso o destino DEVE pertencer ao mesmo dono.
create or replace function public.notas_reopen_task(p_task_id uuid, p_target_status text)
returns void
language plpgsql
security definer
set search_path = public
as $$
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

  -- default: TODO do mesmo dono (mesmo prefixo de 37 chars)
  if v_target is null then
    v_target := left(v_cur, 37) || 'TODO';
  end if;

  -- destino deve pertencer ao MESMO dono e existir em custom_statuses
  if left(v_target, 37) <> left(v_cur, 37)
     or not exists (select 1 from public.custom_statuses where key = v_target) then
    raise exception 'status de destino inválido';
  end if;

  -- autorização: dono da task OU a categoria de destino é compartilhada comigo
  -- OU a nota (via task) foi compartilhada comigo com EDIT.
  if not (
       v_creator = v_uid
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

grant execute on function public.notas_reopen_task(uuid, text) to authenticated;

-- 5) Realtime ----------------------------------------------------------------
-- Adiciona a tabela à publication do Realtime (se ainda não estiver).
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'notas_notifications'
  ) then
    alter publication supabase_realtime add table public.notas_notifications;
  end if;
exception when undefined_object then
  -- publication não existe neste ambiente — ignora.
  null;
end $$;
