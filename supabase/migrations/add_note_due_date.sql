-- Prazo próprio da SUBNOTA. Subnotas não têm task no Ops, então o prazo delas não
-- pode viver em tasks.due_date — vive aqui, na própria nota. É informativo (etiqueta
-- de data na subnota), NÃO gera tarefa/lembrete no board do Ops. Notas RAIZ continuam
-- usando tasks.due_date (esta coluna fica NULL nelas). Aditivo/nullable — o Ops não
-- referencia notes, então não é afetado.
--
-- Status: ✅ APLICADO na VPS (ic-supabase-db), jul/2026.
ALTER TABLE notes ADD COLUMN IF NOT EXISTS due_date timestamptz NULL;
