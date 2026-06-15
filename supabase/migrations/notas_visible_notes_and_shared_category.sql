-- ============================================================================
-- Mileto Notas — visibilidade de notas/tasks/seções (jun/2026, v1.3.9)
-- ============================================================================
-- Conserta dois bugs de "notas não carregando":
--
-- (a) Tarefa na MINHA coluna cuja NOTA foi criada por OUTRA pessoa (ex.: o dono)
--     não aparecia: a RLS de `notes` era por creator_id/núcleo e bloqueava ler
--     nota de terceiro, mesmo na coluna do próprio usuário.
--
-- (b) Categoria COMPARTILHADA (`category_shares`) não aparecia nem pro destinatário
--     REAL: ele lia o `category_shares` e a `note`, mas NÃO a `custom_status` nem
--     as `tasks` daquela categoria (tabelas do Ops), então o snapshot do front
--     nunca conseguia montar a seção compartilhada.
--
-- Todas as policies são SELECT, PERMISSIVE (OR-combinadas) — só LIBERAM leitura,
-- não removem nada existente. As de `tasks`/`custom_statuses` tocam tabelas do Ops,
-- mas NÃO criam coluna no board do Ops (que filtra status like 'USR_<eu>_%') —
-- apenas tornam as linhas da categoria compartilhada legíveis pro destinatário.
--
-- ⚠️ BANCO COMPARTILHADO COM O MILETO OPS — manter registrado no CLAUDE.md (item 10
--    de "A PASSAR PRO OPS") e replicar o conhecimento no Ops.
-- ============================================================================

begin;

-- (a) NOTAS: leio a nota de QUALQUER task que eu já consiga ler. A subquery em
-- `tasks` roda sob a RLS do próprio usuário, então a nota fica exatamente tão
-- visível quanto a tarefa vinculada (modelo nota = task 1:1).
drop policy if exists notes_select_linked_task on public.notes;
create policy notes_select_linked_task on public.notes
  for select to authenticated
  using (
    task_id is not null
    and exists (select 1 from public.tasks t where t.id = notes.task_id)
  );

-- (b) TASKS (tabela do Ops): destinatário de uma categoria compartilhada no Notas
-- (`category_shares`) lê as tasks daquela categoria. Reusa o helper SECDEF já
-- existente `notas_category_shared_with_me(p_task_id uuid)`.
drop policy if exists notas_tasks_select_shared_category on public.tasks;
create policy notas_tasks_select_shared_category on public.tasks
  for select to authenticated
  using (notas_category_shared_with_me(id));

-- (b) CUSTOM_STATUSES (tabela do Ops): destinatário lê a row da custom_status da
-- categoria compartilhada com ele (cabeçalho da seção no snapshot).
drop policy if exists notas_cs_select_shared_category on public.custom_statuses;
create policy notas_cs_select_shared_category on public.custom_statuses
  for select to authenticated
  using (
    exists (
      select 1 from public.category_shares cs
      where cs.category_key = custom_statuses.key
        and cs.shared_with = auth.uid()
    )
  );

commit;
