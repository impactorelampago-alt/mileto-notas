-- ============================================================================
-- Mileto Notas — permitir configurar programa em categoria compartilhada
-- Data: 2026-08-25
--
-- Mantém as ações estruturais da categoria exclusivas do dono. Esta RPC altera
-- somente a classificação global usada pelo Histórico de Programas e exige:
--   1) acesso ao Histórico; e
--   2) categoria própria OU compartilhada com o usuário autenticado.
-- ============================================================================

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

DO $guard$
BEGIN
  IF to_regclass('public.custom_statuses') IS NULL
     OR to_regclass('public.category_shares') IS NULL
     OR to_regclass('public.notas_programs') IS NULL THEN
    RAISE EXCEPTION 'Pré-requisitos de categorias compartilhadas/programas não encontrados';
  END IF;

  IF to_regprocedure('public.current_account_id()') IS NULL
     OR to_regprocedure('public.notas_owns_category_key(text)') IS NULL
     OR to_regprocedure('public.notas_program_access_level()') IS NULL THEN
    RAISE EXCEPTION 'Helpers de conta/permissão de programas não encontrados';
  END IF;
END
$guard$;

CREATE OR REPLACE FUNCTION public.notas_set_category_program(
  p_category_key text,
  p_is_program boolean
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_uid uuid := auth.uid();
  v_account uuid := public.current_account_id();
  v_status record;
  v_program_id uuid;
BEGIN
  IF public.notas_program_access_level() = 'NONE' THEN
    RAISE EXCEPTION 'sem permissão para configurar categorias de programa';
  END IF;

  SELECT status.key, status.label, status.color, status.account_id
    INTO v_status
    FROM public.custom_statuses AS status
   WHERE status.key = p_category_key;

  IF NOT FOUND OR v_status.account_id IS DISTINCT FROM v_account THEN
    RAISE EXCEPTION 'categoria inexistente ou fora da conta atual';
  END IF;

  IF NOT (
    public.notas_owns_category_key(p_category_key)
    OR EXISTS (
      SELECT 1
        FROM public.category_shares AS share
       WHERE share.category_key = p_category_key
         AND share.shared_with = v_uid
    )
  ) THEN
    RAISE EXCEPTION 'somente o dono ou um destinatário da categoria compartilhada pode alterar seu tipo';
  END IF;

  IF p_category_key ~ '_(TODO|IN_PROGRESS|IN_REVIEW|DONE|CANCELLED)$' THEN
    RAISE EXCEPTION 'categorias de sistema não podem ser programas';
  END IF;

  IF p_is_program THEN
    INSERT INTO public.notas_programs AS program
      (account_id, category_key, name, color, active, created_by, updated_at)
    VALUES
      (v_account, p_category_key, v_status.label, coalesce(v_status.color, '#10b981'), true, v_uid, now())
    ON CONFLICT (account_id, category_key)
    DO UPDATE SET
      name = EXCLUDED.name,
      color = EXCLUDED.color,
      active = true,
      updated_at = now()
    RETURNING program.id INTO v_program_id;
  ELSE
    UPDATE public.notas_programs AS program
       SET active = false,
           updated_at = now()
     WHERE program.account_id = v_account
       AND program.category_key = p_category_key
    RETURNING program.id INTO v_program_id;
  END IF;

  RETURN v_program_id;
END
$fn$;

COMMENT ON FUNCTION public.notas_set_category_program(text, boolean) IS
  'Classifica categoria própria ou realmente compartilhada com auth.uid() como programa; exige acesso ao Histórico.';

REVOKE ALL ON FUNCTION public.notas_set_category_program(text, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.notas_set_category_program(text, boolean)
  TO authenticated;

COMMIT;

-- Pós-aplicação sugerido:
-- SELECT pg_get_functiondef('public.notas_set_category_program(text,boolean)'::regprocedure);
