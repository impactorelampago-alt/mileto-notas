-- =============================================================================
-- EXECUCAO MANUAL CONTROLADA - categorias legadas da conta Mileto
-- =============================================================================
-- Pre-requisitos:
--   1. aplicar as migrations 20260810160000..20260810160300;
--   2. gerar backup/snapshot do banco;
--   3. executar o bloco de PREVIEW abaixo e conferir os resultados no Ops;
--   4. aplicar este arquivo uma unica vez via psql com ON_ERROR_STOP=1.
--
-- Escopo fixo: conta Mileto 48d41188-e1d7-4fc8-a878-8de2733ca215.
-- DONE nao entra: segue como estado tecnico do fluxo de conclusao.
-- Nenhuma note/subnote e apagada. Tasks sao movidas ao TODO do mesmo dono.
-- =============================================================================

-- PREVIEW (somente leitura; pode ser executado separadamente antes do arquivo):
-- SELECT task.status, count(*)
--   FROM public.tasks AS task
--  WHERE task.account_id = '48d41188-e1d7-4fc8-a878-8de2733ca215'::uuid
--    AND (
--      task.status ~ '^USR_[0-9A-Fa-f]{32}_(IN_PROGRESS|IN_REVIEW|CANCELLED)$'
--      OR task.status = 'USR_8e3759a7917849a58d8ac9fe7d46c4c0_FINANCEIRO'
--    )
--  GROUP BY task.status
--  ORDER BY task.status;

BEGIN;

-- Fecha a corrida com clientes antigos: o trigger de integridade das tasks toma
-- FOR KEY SHARE nessas rows e ficará bloqueado até o COMMIT. Depois do DELETE,
-- qualquer tentativa tardia de usar uma key removida falha sem criar órfã.
DO $lock$
BEGIN
  PERFORM status.id
    FROM public.custom_statuses AS status
   WHERE status.account_id = '48d41188-e1d7-4fc8-a878-8de2733ca215'::uuid
     AND (
       status.key ~ '^USR_[0-9A-Fa-f]{32}_(IN_PROGRESS|IN_REVIEW|CANCELLED)$'
       OR status.key = 'USR_8e3759a7917849a58d8ac9fe7d46c4c0_FINANCEIRO'
     )
   FOR UPDATE;
END;
$lock$;

-- Abortamos tudo se qualquer task candidata não tiver TODO válido na mesma conta.
DO $validate$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM public.tasks AS task
     WHERE task.account_id = '48d41188-e1d7-4fc8-a878-8de2733ca215'::uuid
       AND (
         task.status ~ '^USR_[0-9A-Fa-f]{32}_(IN_PROGRESS|IN_REVIEW|CANCELLED)$'
         OR task.status = 'USR_8e3759a7917849a58d8ac9fe7d46c4c0_FINANCEIRO'
       )
       AND NOT EXISTS (
         SELECT 1
           FROM public.custom_statuses AS reminder
          WHERE reminder.key = left(task.status, 37) || 'TODO'
            AND reminder.account_id = task.account_id
       )
  ) THEN
    RAISE EXCEPTION 'cleanup abortado: existe task sem Lembrete valido na mesma conta';
  END IF;
END;
$validate$;

-- Anexa cada lote depois da maior position de seu TODO e preserva a ordem relativa.
WITH candidates AS (
  SELECT task.id,
         task.account_id,
         left(task.status, 37) || 'TODO' AS target_key,
         task.position,
         task.created_at
    FROM public.tasks AS task
   WHERE task.account_id = '48d41188-e1d7-4fc8-a878-8de2733ca215'::uuid
     AND (
       task.status ~ '^USR_[0-9A-Fa-f]{32}_(IN_PROGRESS|IN_REVIEW|CANCELLED)$'
       OR task.status = 'USR_8e3759a7917849a58d8ac9fe7d46c4c0_FINANCEIRO'
     )
), target_max AS (
  SELECT candidate.target_key,
         candidate.account_id,
         COALESCE(MAX(existing.position), -1) AS max_position
    FROM (SELECT DISTINCT target_key, account_id FROM candidates) AS candidate
    LEFT JOIN public.tasks AS existing
      ON existing.status = candidate.target_key
     AND existing.account_id = candidate.account_id
   GROUP BY candidate.target_key, candidate.account_id
), ranked AS (
  SELECT candidate.id,
         candidate.target_key,
         target_max.max_position
           + row_number() OVER (
               PARTITION BY candidate.target_key, candidate.account_id
               ORDER BY candidate.position NULLS LAST, candidate.created_at, candidate.id
             )::integer AS new_position
    FROM candidates AS candidate
    JOIN target_max
      ON target_max.target_key = candidate.target_key
     AND target_max.account_id = candidate.account_id
)
UPDATE public.tasks AS task
   SET status = ranked.target_key,
       position = ranked.new_position
  FROM ranked
 WHERE task.id = ranked.id;

DO $verify$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM public.tasks AS task
     WHERE task.account_id = '48d41188-e1d7-4fc8-a878-8de2733ca215'::uuid
       AND (
         task.status ~ '^USR_[0-9A-Fa-f]{32}_(IN_PROGRESS|IN_REVIEW|CANCELLED)$'
         OR task.status = 'USR_8e3759a7917849a58d8ac9fe7d46c4c0_FINANCEIRO'
       )
  ) THEN
    RAISE EXCEPTION 'cleanup abortado: ainda existem tasks nas categorias removidas';
  END IF;
END;
$verify$;

DELETE FROM public.notas_category_group_items AS item
 WHERE item.account_id = '48d41188-e1d7-4fc8-a878-8de2733ca215'::uuid
   AND (
     item.category_key ~ '^USR_[0-9A-Fa-f]{32}_(IN_PROGRESS|IN_REVIEW|CANCELLED)$'
     OR item.category_key = 'USR_8e3759a7917849a58d8ac9fe7d46c4c0_FINANCEIRO'
   );

DELETE FROM public.category_shares AS share
 WHERE EXISTS (
   SELECT 1
     FROM public.custom_statuses AS status
    WHERE status.key = share.category_key
      AND status.account_id = '48d41188-e1d7-4fc8-a878-8de2733ca215'::uuid
      AND (
        status.key ~ '^USR_[0-9A-Fa-f]{32}_(IN_PROGRESS|IN_REVIEW|CANCELLED)$'
        OR status.key = 'USR_8e3759a7917849a58d8ac9fe7d46c4c0_FINANCEIRO'
      )
 );

DELETE FROM public.custom_statuses AS status
 WHERE status.account_id = '48d41188-e1d7-4fc8-a878-8de2733ca215'::uuid
   AND (
     status.key ~ '^USR_[0-9A-Fa-f]{32}_(IN_PROGRESS|IN_REVIEW|CANCELLED)$'
     OR status.key = 'USR_8e3759a7917849a58d8ac9fe7d46c4c0_FINANCEIRO'
   );

COMMIT;
