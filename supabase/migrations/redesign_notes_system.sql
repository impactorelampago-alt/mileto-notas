-- NOTA: A tabela note_categories existe no banco mas NÃO é usada pelo app.
-- As categorias são fixas no código: 'empresas', 'tarefas', 'equipe'.
-- Ela é mantida para uso futuro (ex: categorias personalizadas por usuário).

-- Remove a FK que impedia valores de texto livre no campo category_id
ALTER TABLE notes DROP CONSTRAINT IF EXISTS notes_category_id_fkey;

-- Converte o campo de UUID para TEXT, permitindo os valores fixos do app
ALTER TABLE notes ALTER COLUMN category_id TYPE TEXT USING category_id::TEXT;
