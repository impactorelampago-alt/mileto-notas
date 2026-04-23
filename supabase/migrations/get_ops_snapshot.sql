-- =============================================================================
-- RPC: get_ops_snapshot
-- =============================================================================
-- Retorna um snapshot atômico com TODAS as sections (inclusive vazias)
-- e todas as tasks, numa única chamada transacional.
--
-- Usado pelo Ops Notas para reconstruir o estado canônico de domínio.
-- A ordem das sections respeita a ordenação por key no banco.
-- =============================================================================

CREATE OR REPLACE FUNCTION get_ops_snapshot()
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  sections_json JSON;
  tasks_json JSON;
BEGIN
  -- Sections: todas as sections, deduplicadas por label.
  -- DISTINCT ON (cs.label) mantém a primeira row por label (menor key).
  -- O json_agg externo ordena pelo sort_key para preservar a ordem real.
  SELECT COALESCE(
    json_agg(
      json_build_object(
        'label',      s.label,
        'color',      s.color,
        'key_suffix', s.key_suffix
      ) ORDER BY s.sort_key
    ),
    '[]'::json
  )
  INTO sections_json
  FROM (
    SELECT DISTINCT ON (cs.label)
      cs.label,
      cs.color,
      split_part(cs.key, '_', array_length(string_to_array(cs.key, '_'), 1)) AS key_suffix,
      cs.key AS sort_key
    FROM custom_statuses cs
    ORDER BY cs.label, cs.key
  ) s;

  -- Tasks: todas, ordenadas por título
  SELECT COALESCE(
    json_agg(
      json_build_object(
        'id',     t.id,
        'title',  t.title,
        'status', t.status
      ) ORDER BY t.title
    ),
    '[]'::json
  )
  INTO tasks_json
  FROM tasks t;

  RETURN json_build_object(
    'sections', sections_json,
    'tasks',    tasks_json
  );
END;
$$;

-- =============================================================================
-- VALIDAÇÃO
-- =============================================================================
-- Execute no SQL Editor do Supabase para validar:
--
--   SELECT get_ops_snapshot();
--
-- Deve retornar JSON com:
--   { "sections": [...], "tasks": [...] }
--
-- Se custom_statuses tiver uma coluna "position" para ordenação,
-- troque a ORDER BY de cs.key para cs.position no bloco de sections.
-- =============================================================================
