-- ============================================================================
-- Mileto Notas — estado colaborativo/histórico/mídia de subnota herdam a raiz
-- ----------------------------------------------------------------------------
-- Incidente real: uma subnota criada por Barbara aparecia na árvore com o título,
-- mas abria vazia para Arthur. Ele podia editar a linha em notes, porque
-- user_can_edit_note já resolve a task da raiz, porém não conseguia ler note_yjs:
-- a policy dessa tabela chama user_can_view_note, cuja versão anterior consultava
-- apenas task_id da própria subnota (sempre NULL). A mesma divergência atingia
-- note_edits e qualquer tabela auxiliar protegida por esse helper.
--
-- notas_note_visible_to já é o predicado canônico e subnota-aware: resolve a nota e
-- task raiz, categoria própria/compartilhada, núcleo, DONO e note_share herdado.
-- user_can_view_note passa a delegar a ele para que texto e dados auxiliares tenham
-- exatamente a mesma visibilidade da nota.
--
-- Aditivo/idempotente. Não cria tabela/coluna. Banco compartilhado com Mileto Ops:
-- preservar esta definição no espelho de schema e não recriar user_can_view_note
-- com a versão antiga baseada somente em notes.task_id.
-- ============================================================================

create or replace function public.user_can_view_note(target_note_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $fn$
  select auth.uid() is not null
    and public.notas_note_visible_to(target_note_id, auth.uid());
$fn$;

revoke all on function public.user_can_view_note(uuid) from public;
grant execute on function public.user_can_view_note(uuid) to authenticated;

comment on function public.user_can_view_note(uuid) is
  'Visibilidade canônica de nota e subnota; herda nota/task raiz para RLS de tabelas auxiliares.';
