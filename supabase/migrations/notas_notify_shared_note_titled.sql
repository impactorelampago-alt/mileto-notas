-- ============================================================================
-- Mileto Notas — Notificação "nova nota em categoria compartilhada": título certo + note_id
-- ----------------------------------------------------------------------------
-- ANTES (caveat item 9): o aviso `note_created` disparava no INSERT da TASK
-- (trg_notas_notify_on_shared_note em tasks), então o título costumava vir "Nova
-- nota"/"Sem título" (antes do auto-título) e a notificação apontava só por task_id
-- (note_id NULL) — abrir dependia da nota já estar carregada.
--
-- AGORA: dispara em `notes` (INSERT + UPDATE OF title), mas SÓ quando a nota-raiz ganha
-- um TÍTULO REAL (não genérico) e AINDA NÃO notificou (dedup por note_id) → a notificação
-- vem com o título de verdade + note_id (deep-link confiável; o front faz fetch se preciso).
-- Best-effort (EXCEPTION) — nunca aborta a escrita da nota. Subnota (task_id NULL) não gera.
--
-- ⚠️ BANCO COMPARTILHADO — objeto SÓ do Notas (sino próprio). Remove o trigger antigo em
-- `tasks` (senão notifica em dobro). O Ops não usa/registra este sino.
-- ============================================================================

create or replace function public.notas_notify_shared_note()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_actor  uuid := auth.uid();
  v_status text;
begin
  if NEW.task_id is null then return NEW; end if; -- só nota-RAIZ (subnota não tem task)
  -- título ainda genérico → não notifica agora (espera virar título real no UPDATE).
  if NEW.title is null or NEW.title = '' or NEW.title = 'Sem titulo'
     or NEW.title = 'Sem título' or NEW.title = 'Nova nota' then
    return NEW;
  end if;
  select status into v_status from public.tasks where id = NEW.task_id;
  if v_status is null then return NEW; end if;
  -- dedup: já notifiquei esta nota? (dispara UMA vez, no 1º título real)
  if exists (select 1 from public.notas_notifications
             where note_id = NEW.id and type = 'note_created') then
    return NEW;
  end if;
  begin
    insert into public.notas_notifications (recipient_id, actor_id, task_id, note_id, title, type)
    select cs.shared_with, v_actor, NEW.task_id, NEW.id, NEW.title, 'note_created'
    from public.category_shares cs
    where cs.category_key = v_status
      and cs.shared_with is distinct from NEW.creator_id
      and cs.shared_with is distinct from v_actor;
  exception when others then
    null; -- best-effort: nunca aborta a escrita da nota
  end;
  return NEW;
end $$;

drop trigger if exists trg_notas_notify_shared_note_ins on public.notes;
create trigger trg_notas_notify_shared_note_ins
  after insert on public.notes
  for each row execute function public.notas_notify_shared_note();

drop trigger if exists trg_notas_notify_shared_note_upd on public.notes;
create trigger trg_notas_notify_shared_note_upd
  after update of title on public.notes
  for each row execute function public.notas_notify_shared_note();

-- Remove o trigger ANTIGO (em tasks) — evita notificação em dobro com título genérico.
drop trigger if exists trg_notas_notify_on_shared_note on public.tasks;
