-- ============================================================================
-- Mileto Notas — Realtime para shares (categoria/nota compartilhada na hora)
-- ----------------------------------------------------------------------------
-- Adiciona category_shares e note_shares à publication do Realtime para o app
-- recarregar shares instantaneamente quando o dono compartilha (sem reabrir).
-- O Realtime respeita RLS (category_shares_select / note_shares_select), então
-- cada usuário só recebe as linhas que pode ver. Idempotente.
-- ============================================================================
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'category_shares'
  ) then
    alter publication supabase_realtime add table public.category_shares;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'note_shares'
  ) then
    alter publication supabase_realtime add table public.note_shares;
  end if;
exception when undefined_object then
  null; -- publication não existe neste ambiente
end $$;
