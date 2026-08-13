-- ============================================================================
-- Mileto Notas - scalariza a barreira global de staff em public.tasks
-- 2026-08-13 (migration Supabase 20260813111902)
--
-- `tasks_staff_only` e RESTRICTIVE e participa de toda leitura/escrita em
-- `public.tasks`. A chamada direta a `public.is_staff()` dentro da expressao RLS
-- pode ser reavaliada para cada linha; coloca-la em um scalar subquery permite
-- que o PostgreSQL a transforme em InitPlan e a avalie uma vez por statement.
--
-- A mudanca e somente de forma/performance: nome, tabela, modo RESTRICTIVE,
-- comando ALL, role authenticated e as expressoes logicas de USING/WITH CHECK
-- permanecem identicos. A troca ocorre atomicamente dentro desta transacao, sem
-- janela em que a tabela fique sem a barreira. Migration forward-only e
-- replay-safe; nao altera dados nem policies permissivas do Ops/Notas.
-- ============================================================================

BEGIN;

-- Policy DDL precisa de locks fortes e o banco compartilhado tem trafego
-- continuo. Limites curtos fazem o deploy falhar de forma segura em vez de
-- aguardar indefinidamente; a ordem de locks abaixo segue o caminho normal das
-- consultas (auth.sessions -> tasks) para evitar ciclos com o PostgREST.
SET LOCAL lock_timeout = '9s';
SET LOCAL statement_timeout = '20s';
SET LOCAL idle_in_transaction_session_timeout = '25s';

-- Falhar antes do DROP se o banco compartilhado nao estiver no estado esperado.
-- Isso evita transformar um deploy parcial em alteracao silenciosa de acesso.
DO $guard$
DECLARE
  v_rls_enabled boolean;
BEGIN
  IF to_regclass('public.tasks') IS NULL THEN
    RAISE EXCEPTION 'pre-requisito ausente: public.tasks';
  END IF;

  IF to_regclass('auth.sessions') IS NULL THEN
    RAISE EXCEPTION 'pre-requisito ausente: auth.sessions';
  END IF;

  IF to_regprocedure('public.is_staff()') IS NULL THEN
    RAISE EXCEPTION 'pre-requisito ausente: public.is_staff()';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_proc AS procedure
    JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid = procedure.pronamespace
    WHERE namespace.nspname = 'public'
      AND procedure.proname = 'is_staff'
      AND procedure.pronargs = 0
      AND procedure.prorettype = 'boolean'::regtype
      AND procedure.provolatile = 's'
      AND procedure.prosecdef = true
  ) THEN
    RAISE EXCEPTION
      'pre-requisito invalido: public.is_staff() deve ser STABLE SECURITY DEFINER, sem argumentos e retornar boolean';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_roles
    WHERE rolname = 'authenticated'
  ) THEN
    RAISE EXCEPTION 'pre-requisito ausente: role authenticated';
  END IF;

  SELECT relrowsecurity
    INTO v_rls_enabled
  FROM pg_catalog.pg_class
  WHERE oid = 'public.tasks'::regclass;

  IF NOT v_rls_enabled THEN
    RAISE EXCEPTION 'pre-requisito invalido: RLS esta desabilitada em public.tasks';
  END IF;
END;
$guard$;

DO $replace_policy$
DECLARE
  v_policy_count integer;
  v_authenticated_oid oid;
  v_permissive boolean;
  v_command text;
  v_roles oid[];
  v_using_expr text;
  v_check_expr text;
  v_using_kind text;
  v_check_kind text;
BEGIN
  SELECT oid
    INTO v_authenticated_oid
  FROM pg_catalog.pg_roles
  WHERE rolname = 'authenticated';

  SELECT count(*)
    INTO v_policy_count
  FROM pg_catalog.pg_policy
  WHERE polrelid = 'public.tasks'::regclass
    AND polname = 'tasks_staff_only';

  IF v_policy_count <> 1 THEN
    RAISE EXCEPTION
      'precondicao falhou: esperado exatamente 1 tasks_staff_only; encontrado %',
      v_policy_count;
  END IF;

  SELECT
    policy.polpermissive,
    policy.polcmd,
    policy.polroles,
    replace(
      lower(regexp_replace(
        pg_catalog.pg_get_expr(policy.polqual, policy.polrelid),
        '[[:space:]]+', '', 'g'
      )),
      'public.', ''
    ),
    replace(
      lower(regexp_replace(
        pg_catalog.pg_get_expr(policy.polwithcheck, policy.polrelid),
        '[[:space:]]+', '', 'g'
      )),
      'public.', ''
    )
  INTO
    v_permissive,
    v_command,
    v_roles,
    v_using_expr,
    v_check_expr
  FROM pg_catalog.pg_policy AS policy
  WHERE policy.polrelid = 'public.tasks'::regclass
    AND policy.polname = 'tasks_staff_only';

  IF v_permissive
     OR v_command <> '*'
     OR v_roles <> ARRAY[v_authenticated_oid]::oid[] THEN
    RAISE EXCEPTION
      'precondicao falhou: tasks_staff_only nao e RESTRICTIVE FOR ALL TO authenticated';
  END IF;

  v_using_kind := CASE
    WHEN v_using_expr = 'is_staff()' THEN 'direct'
    WHEN v_using_expr IN (
      '(selectis_staff())',
      '(selectis_staff()asis_staff)'
    ) THEN 'scalar'
    ELSE 'unexpected'
  END;

  v_check_kind := CASE
    WHEN v_check_expr = 'is_staff()' THEN 'direct'
    WHEN v_check_expr IN (
      '(selectis_staff())',
      '(selectis_staff()asis_staff)'
    ) THEN 'scalar'
    ELSE 'unexpected'
  END;

  IF v_using_kind NOT IN ('direct', 'scalar')
     OR v_check_kind NOT IN ('direct', 'scalar')
     OR v_using_kind <> v_check_kind THEN
    RAISE EXCEPTION
      'precondicao falhou: expressoes inesperadas em tasks_staff_only (USING=%, WITH CHECK=%)',
      v_using_expr,
      v_check_expr;
  END IF;

  -- Replay depois de uma aplicacao bem-sucedida (ou da correcao equivalente do
  -- Ops) vira no-op. ALTER preserva o OID/comentario da policy e evita a
  -- superficie adicional de locks/dependencias de um DROP/CREATE no banco vivo.
  -- Somente a definicao direta, conhecida, pode ser substituida.
  IF v_using_kind = 'direct' THEN
    -- A expressao de is_staff depende da sessao autenticada. Adquirir
    -- auth.sessions primeiro drena as requisicoes ja iniciadas e impede o
    -- deadlock observado quando uma consulta segura auth.sessions e depois tenta
    -- ler tasks enquanto o DDL faz o caminho inverso. No replay scalarizado este
    -- bloco nao executa e nenhuma barreira global e criada.
    EXECUTE 'LOCK TABLE auth.sessions IN ACCESS EXCLUSIVE MODE';
    EXECUTE 'LOCK TABLE public.tasks IN ACCESS EXCLUSIVE MODE';

    -- Revalida depois dos locks: uma alteracao concorrente do Ops entre a leitura
    -- inicial e a barreira nunca pode ser sobrescrita silenciosamente.
    IF NOT EXISTS (
      SELECT 1
      FROM pg_catalog.pg_policy AS policy
      WHERE policy.polrelid = 'public.tasks'::regclass
        AND policy.polname = 'tasks_staff_only'
        AND policy.polpermissive = false
        AND policy.polcmd = '*'
        AND policy.polroles = ARRAY[v_authenticated_oid]::oid[]
        AND replace(
              lower(regexp_replace(
                pg_catalog.pg_get_expr(policy.polqual, policy.polrelid),
                '[[:space:]]+', '', 'g'
              )),
              'public.', ''
            ) = 'is_staff()'
        AND replace(
              lower(regexp_replace(
                pg_catalog.pg_get_expr(policy.polwithcheck, policy.polrelid),
                '[[:space:]]+', '', 'g'
              )),
              'public.', ''
            ) = 'is_staff()'
    ) THEN
      RAISE EXCEPTION
        'precondicao falhou depois dos locks: tasks_staff_only mudou concorrentemente';
    END IF;

    EXECUTE $alter_policy$
      ALTER POLICY tasks_staff_only
        ON public.tasks
        TO authenticated
        USING ((SELECT public.is_staff()))
        WITH CHECK ((SELECT public.is_staff()))
    $alter_policy$;
  END IF;
END;
$replace_policy$;

-- Validacao estrutural sem executar is_staff() nem consultar dados de negocio.
-- A transacao inteira e revertida se a policy recriada divergir do contrato.
DO $validate$
DECLARE
  v_policy_count integer;
  v_authenticated_oid oid;
  v_permissive boolean;
  v_command text;
  v_roles oid[];
  v_using_expr text;
  v_check_expr text;
BEGIN
  SELECT oid
    INTO v_authenticated_oid
  FROM pg_catalog.pg_roles
  WHERE rolname = 'authenticated';

  SELECT count(*)
    INTO v_policy_count
  FROM pg_catalog.pg_policy AS policy
  WHERE policy.polrelid = 'public.tasks'::regclass
    AND policy.polname = 'tasks_staff_only';

  IF v_policy_count <> 1 THEN
    RAISE EXCEPTION
      'validacao falhou: esperado exatamente 1 tasks_staff_only; encontrado %',
      v_policy_count;
  END IF;

  SELECT
    policy.polpermissive,
    policy.polcmd,
    policy.polroles,
    replace(
      lower(regexp_replace(
        pg_catalog.pg_get_expr(policy.polqual, policy.polrelid),
        '[[:space:]]+', '', 'g'
      )),
      'public.', ''
    ),
    replace(
      lower(regexp_replace(
        pg_catalog.pg_get_expr(policy.polwithcheck, policy.polrelid),
        '[[:space:]]+', '', 'g'
      )),
      'public.', ''
    )
  INTO
    v_permissive,
    v_command,
    v_roles,
    v_using_expr,
    v_check_expr
  FROM pg_catalog.pg_policy AS policy
  WHERE policy.polrelid = 'public.tasks'::regclass
    AND policy.polname = 'tasks_staff_only';

  IF v_permissive
     OR v_command <> '*'
     OR v_roles <> ARRAY[v_authenticated_oid]::oid[]
     OR v_using_expr IS NULL
     OR v_check_expr IS NULL
     OR v_using_expr NOT IN (
       '(selectis_staff())',
       '(selectis_staff()asis_staff)'
     )
     OR v_check_expr <> v_using_expr THEN
    RAISE EXCEPTION
      'validacao falhou: tasks_staff_only divergiu do contrato scalarizado (USING=%, WITH CHECK=%)',
      v_using_expr,
      v_check_expr;
  END IF;
END;
$validate$;

COMMIT;
