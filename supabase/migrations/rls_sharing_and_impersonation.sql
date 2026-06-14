-- =============================================================================
-- MILETO OPS / NOTAS — PACOTE RLS FINAL: IMPERSONACAO (DONO) + COMPARTILHAMENTO
-- =============================================================================
-- Alvo: Supabase SELF-HOSTED (Postgres + GoTrue). auth.uid() = usuario do TOKEN.
-- Banco de PRODUCAO, multiusuario, compartilhado com o app web Mileto Ops.
--
-- *** ESTE SCRIPT NAO E APLICADO POR NOS. Revise e execute no SQL Editor. ***
--
-- PROPRIEDADES:
--   * IDEMPOTENTE: CREATE ... IF NOT EXISTS, DROP POLICY IF EXISTS antes de CREATE.
--   * ADITIVO em `notes`: cria SO policies PERMISSIVE NOVAS (nomes proprios), que
--     sao OR'd com as existentes. NUNCA dropa/altera as policies atuais de notes
--     (creator_id=auth.uid() OR note_collaborators) -> o acesso atual fica intacto.
--   * SEGURO: cada liberacao e estrita; nenhum acesso "geral" e concedido sem querer.
--
-- FATO CENTRAL (verificado no codigo do app):
--   A impersonacao ("trocar de conta") NAO troca o token JWT. auth-store.ts:151-161
--   (setViewingAs mantem a sessao; getEffectiveUserId = viewingAs?.id ?? user?.id) e
--   notes-store.ts:184-190 (loadNotes reusa o mesmo _notesToken e so muda o filtro
--   ?creator_id=eq.<id-visualizado>). Logo auth.uid() continua sendo o DONO, e ler
--   notas de outra pessoa depende EXCLUSIVAMENTE da policy "DONO le tudo" (secao 4.1).
--
-- ATENCAO antes de rodar: leia "QUE O USUARIO PRECISA VERIFICAR" no retorno.
-- Em especial: a feature de CATEGORIA so funciona apos o front enviar a KEY COMPLETA
-- (USR_<idSemHifens>_<SUFIXO>) em category_shares.category_key — hoje ele so tem o sufixo.
-- =============================================================================


-- =============================================================================
-- PARTE A — PACOTE PRINCIPAL (rode dentro da transacao abaixo)
-- =============================================================================
BEGIN;

-- -----------------------------------------------------------------------------
-- 0) HELPERS (SECURITY DEFINER) — anti-recursao, performance, e checagem de posse
-- -----------------------------------------------------------------------------
-- Nomes NAMESPACED com prefixo "notas_" de proposito: este banco e compartilhado
-- com o app web Ops; um nome generico (ex.: is_owner) poderia, via CREATE OR
-- REPLACE, sobrescrever silenciosamente uma funcao homonima do Ops. (Verifique a
-- ausencia de colisao no PASSO de validacao V0 antes de rodar.)
--
-- SECURITY DEFINER + search_path travado: a funcao roda como o OWNER (ignora a RLS
-- de profiles/notes de forma controlada), le SO o necessario, e e STABLE. Isso
-- evita (a) depender da RLS de profiles e (b) recursao de policy (uma policy de
-- notes que faca SELECT em notes re-dispararia a RLS de notes -> recursao).

-- 0.1) notas_is_dono(): TRUE se o usuario do token tem profiles.role = 'DONO'.
CREATE OR REPLACE FUNCTION public.notas_is_dono()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles p
    WHERE p.id = auth.uid()
      AND p.role = 'DONO'
  );
$$;

COMMENT ON FUNCTION public.notas_is_dono() IS
  'TRUE se auth.uid() tem profiles.role = DONO. Usada por policies de notes para '
  'impersonacao (DONO le tudo). SECURITY DEFINER p/ nao depender da RLS de profiles.';

-- 0.2) notas_can_share_note(note_id): TRUE se o usuario do token PODE compartilhar
--      a nota — ou seja, e o criador, ou colaborador, ou DONO. Encapsulado em
--      SECURITY DEFINER porque le `notes`/`note_collaborators`: se fosse inline no
--      WITH CHECK de note_shares, a subquery em notes seria avaliada SOB a RLS de
--      notes (que esta sendo definida) e poderia recursar. Aqui le sem RLS, mas SO
--      retorna booleano e SO para o auth.uid() corrente -> nao vaza dados.
CREATE OR REPLACE FUNCTION public.notas_can_share_note(p_note_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT
    public.notas_is_dono()
    OR EXISTS (
      SELECT 1 FROM public.notes n
      WHERE n.id = p_note_id
        AND n.creator_id = auth.uid()
    )
    OR EXISTS (
      SELECT 1 FROM public.note_collaborators nc
      WHERE nc.note_id = p_note_id
        AND nc.user_id = auth.uid()
    );
$$;

COMMENT ON FUNCTION public.notas_can_share_note(uuid) IS
  'TRUE se auth.uid() e criador/colaborador da nota OU DONO. Usada no WITH CHECK '
  'do INSERT de note_shares para impedir compartilhar nota alheia (anti-escalacao).';

-- 0.3) notas_owns_category_key(category_key): TRUE se a key COMPLETA pertence ao
--      usuario do token. Sections custom seguem 'USR_<idSemHifens>_<SUFIXO>'
--      (ops-store.ts:405 createSection, :551-553 createTaskInOps). Validamos que a
--      key comeca com 'USR_' || replace(auth.uid(),'-','') || '_'. DONO tambem pode.
--      Bloqueia compartilhar a section de OUTRA pessoa (anti auto-concessao).
CREATE OR REPLACE FUNCTION public.notas_owns_category_key(p_category_key text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT
    public.notas_is_dono()
    OR (
      p_category_key IS NOT NULL
      AND p_category_key LIKE 'USR\_%'
      AND p_category_key LIKE
          ('USR_' || replace(auth.uid()::text, '-', '') || '_%')
    );
$$;

COMMENT ON FUNCTION public.notas_owns_category_key(text) IS
  'TRUE se a category_key (USR_<idSemHifens>_<SUFIXO>) pertence ao auth.uid() OU DONO. '
  'Usada no WITH CHECK do INSERT de category_shares (anti auto-concessao).';

-- 0.4) notas_category_shared_with_me(task_id): TRUE se a NOTA (via task) esta numa
--      categoria compartilhada com o usuario do token. CASA POR KEY COMPLETA
--      (tasks.status = category_shares.category_key) — igualdade exata, SEM
--      split_part. Isso elimina o vazamento cruzado entre usuarios (sufixos iguais
--      de donos diferentes nao colidem, pois a key embute o id do dono) e tambem o
--      bug do split_part (sufixos com '_' interno, ex. EM_ESPERA_2).
CREATE OR REPLACE FUNCTION public.notas_category_shared_with_me(p_task_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT CASE
    WHEN p_task_id IS NULL THEN false
    ELSE EXISTS (
      SELECT 1
      FROM public.tasks t
      JOIN public.category_shares cs
        ON cs.category_key = t.status          -- IGUALDADE EXATA, key completa
      WHERE t.id = p_task_id
        AND cs.shared_with = auth.uid()
    )
  END;
$$;

COMMENT ON FUNCTION public.notas_category_shared_with_me(uuid) IS
  'TRUE se a nota (via notes.task_id -> tasks.status) esta numa categoria '
  'compartilhada com auth.uid() via category_shares (casamento por key COMPLETA).';

-- Permissao de EXECUTE para o role do PostgREST.
GRANT EXECUTE ON FUNCTION public.notas_is_dono()                       TO authenticated;
GRANT EXECUTE ON FUNCTION public.notas_can_share_note(uuid)            TO authenticated;
GRANT EXECUTE ON FUNCTION public.notas_owns_category_key(text)         TO authenticated;
GRANT EXECUTE ON FUNCTION public.notas_category_shared_with_me(uuid)   TO authenticated;


-- -----------------------------------------------------------------------------
-- 1) TABELA note_shares — com quem cada NOTA foi compartilhada (delegacao)
-- -----------------------------------------------------------------------------
-- Contraparte no banco do mapa local "note-shares" (electron-store, sharing-store.ts).
-- Independente de note_collaborators (que ja existe com seu proprio fluxo).
CREATE TABLE IF NOT EXISTS public.note_shares (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  note_id     uuid NOT NULL REFERENCES public.notes(id) ON DELETE CASCADE,
  shared_with uuid NOT NULL REFERENCES auth.users(id)   ON DELETE CASCADE,
  shared_by   uuid NOT NULL REFERENCES auth.users(id)   ON DELETE CASCADE,
  permission  text NOT NULL DEFAULT 'VIEW' CHECK (permission IN ('VIEW', 'EDIT')),
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT note_shares_unique UNIQUE (note_id, shared_with)
);

COMMENT ON TABLE public.note_shares IS
  'Registro de com quem cada NOTA foi compartilhada. shared_by gerencia; '
  'shared_with ganha LEITURA da nota via policy aditiva em notes (4.2).';

CREATE INDEX IF NOT EXISTS idx_note_shares_shared_with ON public.note_shares (shared_with);
CREATE INDEX IF NOT EXISTS idx_note_shares_note_id     ON public.note_shares (note_id);
CREATE INDEX IF NOT EXISTS idx_note_shares_shared_by   ON public.note_shares (shared_by);

ALTER TABLE public.note_shares ENABLE ROW LEVEL SECURITY;
-- (Sem FORCE: ENABLE ja protege o vetor real (role authenticated/anon via PostgREST).
--  FORCE faria ate funcoes SECURITY DEFINER/owner do Ops respeitarem a RLS — risco
--  sem ganho no modelo PostgREST. service_role tem BYPASSRLS e nao e afetado.)

-- SELECT: quem compartilhou OU o destinatario. (Sem "OR DONO" aqui de proposito:
-- o requisito so pede shared_by gerencia / shared_with le; minimalista.)
DROP POLICY IF EXISTS note_shares_select ON public.note_shares;
CREATE POLICY note_shares_select
  ON public.note_shares
  FOR SELECT
  TO authenticated
  USING (shared_by = auth.uid() OR shared_with = auth.uid());

-- INSERT: so quem compartilha (shared_by = eu) E que REALMENTE pode ver a nota
-- (criador/colaborador OU DONO). Fecha a escalacao: sem isto, qualquer um poderia
-- inserir share apontando para nota alheia e (via policy 4.2) conceder leitura a
-- um comparsa. note_ids vazam (note_collaborators e legivel sem filtro,
-- notes-store.ts:525-533), entao o endurecimento e obrigatorio.
DROP POLICY IF EXISTS note_shares_insert ON public.note_shares;
CREATE POLICY note_shares_insert
  ON public.note_shares
  FOR INSERT
  TO authenticated
  WITH CHECK (
    shared_by = auth.uid()
    AND public.notas_can_share_note(note_id)
  );

-- DELETE: so quem criou o compartilhamento revoga.
DROP POLICY IF EXISTS note_shares_delete ON public.note_shares;
CREATE POLICY note_shares_delete
  ON public.note_shares
  FOR DELETE
  TO authenticated
  USING (shared_by = auth.uid());

-- (Sem UPDATE de proposito: mudar permissao = delete + insert. UPDATE fica negado.)


-- -----------------------------------------------------------------------------
-- 2) TABELA category_shares — com quem cada CATEGORIA/section foi compartilhada
-- -----------------------------------------------------------------------------
-- Contraparte no banco do mapa local "category-shares" do front.
--
-- *** category_key GUARDA A KEY COMPLETA: 'USR_<idSemHifens>_<SUFIXO>' ***
-- (NAO o sufixo). Casa direto e por igualdade exata com tasks.status (que guarda a
-- key completa — ops-store.ts:551-553). Decisao de SEGURANCA: comparar so o sufixo
-- vazaria notas entre usuarios com sections de mesmo nome. Ver RISCOS no retorno.
--
-- PRE-CONDICAO DE FRONT (bloqueante p/ a feature de categoria): hoje o front so tem
-- o key_suffix (sharing-store.ts:8,58; refreshOpsSnapshot descarta a key completa em
-- ops-store.ts:313/318). O front DEVE passar a montar e gravar a KEY COMPLETA aqui,
-- usando EXATAMENTE a mesma derivacao de tasks.status (incluindo o .substring(0,60)
-- de createSection — atencao: createTaskInOps NAO trunca, ver perguntas em aberto).
CREATE TABLE IF NOT EXISTS public.category_shares (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  category_key text NOT NULL,                              -- = custom_statuses.key (= tasks.status)
  shared_with  uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  shared_by    uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT category_shares_unique UNIQUE (category_key, shared_with)
);

COMMENT ON TABLE public.category_shares IS
  'Registro de com quem cada CATEGORIA (section) foi compartilhada. '
  'category_key = KEY COMPLETA (USR_<idSemHifens>_<SUFIXO>), casa exato com tasks.status. '
  'shared_by gerencia; shared_with le as notas dessa section via policy aditiva (4.3).';

CREATE INDEX IF NOT EXISTS idx_category_shares_shared_with  ON public.category_shares (shared_with);
CREATE INDEX IF NOT EXISTS idx_category_shares_category_key ON public.category_shares (category_key);
CREATE INDEX IF NOT EXISTS idx_category_shares_shared_by    ON public.category_shares (shared_by);

ALTER TABLE public.category_shares ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS category_shares_select ON public.category_shares;
CREATE POLICY category_shares_select
  ON public.category_shares
  FOR SELECT
  TO authenticated
  USING (shared_by = auth.uid() OR shared_with = auth.uid());

-- INSERT: so quem compartilha (shared_by = eu) E que e DONO DA CATEGORIA (a key
-- embute o id do dono) OU DONO global. Fecha a auto-concessao: sem isto, um usuario
-- inseriria category_shares(category_key='USR_<idDaVitima>_X', shared_with=eu) e a
-- policy 4.3 liberaria as notas da vitima (as keys nao sao secretas).
DROP POLICY IF EXISTS category_shares_insert ON public.category_shares;
CREATE POLICY category_shares_insert
  ON public.category_shares
  FOR INSERT
  TO authenticated
  WITH CHECK (
    shared_by = auth.uid()
    AND public.notas_owns_category_key(category_key)
  );

DROP POLICY IF EXISTS category_shares_delete ON public.category_shares;
CREATE POLICY category_shares_delete
  ON public.category_shares
  FOR DELETE
  TO authenticated
  USING (shared_by = auth.uid());


-- -----------------------------------------------------------------------------
-- 3) GRANTs de privilegio de TABELA para o role authenticated (alem da RLS)
-- -----------------------------------------------------------------------------
-- RLS so RESTRINGE; nao concede o privilegio SQL base. No PostgREST (role
-- authenticated), sem estes GRANTs o app recebe 42501 "permission denied for table"
-- mesmo com a policy permitindo. (Ausente em ambos os designs originais.)
-- NAO concedemos UPDATE (escrita ampliada nao foi pedida; ver perguntas em aberto).
GRANT SELECT, INSERT, DELETE ON public.note_shares     TO authenticated;
GRANT SELECT, INSERT, DELETE ON public.category_shares TO authenticated;
-- GRANT USAGE ON SCHEMA public TO authenticated;  -- normalmente ja existe; descomente se preciso.


-- -----------------------------------------------------------------------------
-- 4) POLICIES ADITIVAS DE SELECT EM `notes` (PERMISSIVE — OR com as existentes)
-- -----------------------------------------------------------------------------
ALTER TABLE public.notes ENABLE ROW LEVEL SECURITY;  -- idempotente; nao mexe em policies.

-- IMPORTANTE: NAO tocamos em nenhuma policy existente de notes. Apenas criamos
-- policies PERMISSIVE com NOMES NOVOS. Em RLS PERMISSIVE o acesso final e a UNIAO
-- (OR) das policies de SELECT -> estas SO AMPLIAM o acesso, nunca reduzem.

-- 4.1) IMPERSONACAO: o DONO le TODAS as notas (unica via real, o token nao troca).
DROP POLICY IF EXISTS notes_select_dono_reads_all ON public.notes;
CREATE POLICY notes_select_dono_reads_all
  ON public.notes
  AS PERMISSIVE
  FOR SELECT
  TO authenticated
  USING ( public.notas_is_dono() );

-- 4.2) NOTA compartilhada: o destinatario de note_shares le a nota.
DROP POLICY IF EXISTS notes_select_shared_with_me ON public.notes;
CREATE POLICY notes_select_shared_with_me
  ON public.notes
  AS PERMISSIVE
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.note_shares ns
      WHERE ns.note_id = notes.id
        AND ns.shared_with = auth.uid()
    )
  );

-- 4.3) CATEGORIA compartilhada: o destinatario le as notas cujas tasks estao na
--      section compartilhada (casamento por key COMPLETA, sem vazamento cruzado).
DROP POLICY IF EXISTS notes_select_shared_category ON public.notes;
CREATE POLICY notes_select_shared_category
  ON public.notes
  AS PERMISSIVE
  FOR SELECT
  TO authenticated
  USING ( public.notas_category_shared_with_me(task_id) );

-- NOTA SOBRE EDICAO (UPDATE): o requisito pede apenas LEITURA. NAO criamos policies
-- de UPDATE/DELETE aditivas. Hoje note_shares.permission='EDIT' e DECORATIVO (nao
-- habilita escrita). Quando for pedido, criar policy de UPDATE aditiva condicionada
-- a note_shares.permission='EDIT' (USING e WITH CHECK espelhados, sem reassinar
-- creator_id). Ver perguntas em aberto.

-- PONTO DE EXTENSAO — HIERARQUIA (gerente le subordinados): NAO implementado. A
-- tabela de cargos/hierarquia do Ops nao esta disponivel; NAO inventamos tabela.
-- Quando existir: criar funcao SECURITY DEFINER public.notas_pode_supervisionar(
-- target uuid) e uma policy PERMISSIVE de SELECT em notes:
--   USING ( public.notas_pode_supervisionar(notes.creator_id) ).

COMMIT;


-- =============================================================================
-- PARTE B — INDICE EM tasks.status (FORA da transacao, tabela GRANDE/compartilhada)
-- =============================================================================
-- Acelera o JOIN da policy 4.3 (notas_category_shared_with_me). CONCURRENTLY evita
-- lock longo na tabela tasks do app web Ops, mas NAO pode rodar dentro de BEGIN/COMMIT.
-- Rode esta linha SEPARADAMENTE (apos a Parte A):
--
--   CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_tasks_status ON public.tasks (status);
--
-- (Se preferir simplicidade e a tabela for pequena, pode rodar sem CONCURRENTLY
--  dentro de uma transacao propria — avalie o tamanho de tasks antes.)


-- =============================================================================
-- VALIDACAO (rode manualmente; SELECTs nao mutam nada)
-- =============================================================================
-- V0) COLISAO DE NOMES de funcao no banco compartilhado (rode ANTES de aplicar):
--   SELECT proname, pg_get_function_identity_arguments(oid) AS args
--   FROM pg_proc
--   WHERE proname IN ('notas_is_dono','notas_can_share_note',
--                     'notas_owns_category_key','notas_category_shared_with_me')
--     AND pronamespace = 'public'::regnamespace;
--   -- Esperado: vazio antes de aplicar (nomes namespaced, sem colisao com o Ops).
--
-- V1) Tabelas novas existem e tem RLS habilitada (relrowsecurity = true):
--   SELECT relname, relrowsecurity, relforcerowsecurity
--   FROM pg_class WHERE relname IN ('note_shares','category_shares','notes');
--
-- V2) Policies NOVAS de notes existem, PERMISSIVE/SELECT, sem apagar as antigas:
--   SELECT polname, polcmd, polpermissive
--   FROM pg_policy WHERE polrelid = 'public.notes'::regclass ORDER BY polname;
--   -- Esperado: as ORIGINAIS + notes_select_dono_reads_all
--   --           + notes_select_shared_with_me + notes_select_shared_category
--
-- V3) Existe pelo menos um DONO (a impersonacao depende disto):
--   SELECT id, email, role FROM public.profiles WHERE role = 'DONO';
--
-- V4) Impersonacao (logado como um DONO real, via app/token authenticated) — deve
--     retornar notas de OUTROS criadores:
--   SELECT id, title, creator_id FROM public.notes WHERE creator_id <> auth.uid() LIMIT 5;
--
-- V5) Note share (logado como o destinatario):
--   SELECT n.id, n.title FROM public.notes n
--   JOIN public.note_shares ns ON ns.note_id = n.id AND ns.shared_with = auth.uid();
--
-- V6) Diagnostico do casamento categoria<->task (como service_role/SQL editor, sem RLS):
--   SELECT cs.category_key, cs.shared_with, t.id AS task_id, n.id AS note_id
--   FROM public.category_shares cs
--   JOIN public.tasks t ON t.status = cs.category_key
--   JOIN public.notes n ON n.task_id = t.id;
--   -- Se vier VAZIO mas voce espera linhas: confira se category_key foi gravado como
--   --   a KEY COMPLETA (USR_<id>_<SUFIXO>) e nao so o sufixo (ver pre-condicao de front).
--
-- V7) GRANTs aplicados:
--   SELECT grantee, privilege_type, table_name
--   FROM information_schema.role_table_grants
--   WHERE table_name IN ('note_shares','category_shares') AND grantee = 'authenticated';


-- #############################################################################
-- ##  OPCIONAL E SEPARADO — NAO faz parte do pacote de RLS acima.            ##
-- ##  Renomear o status "A Fazer" -> "Lembrete" em custom_statuses.          ##
-- ##  EFEITO GLOBAL no Mileto Ops (afeta o app web). NUNCA alterar `key`     ##
-- ##  (tasks.status referencia a key). So renomear o `label`.                ##
-- #############################################################################
--
-- PASSO 0 — confirmar se a coluna updated_at existe (o schema informado NAO a lista
--           em custom_statuses; se nao existir, REMOVA "updated_at = now()" do UPDATE):
--   SELECT column_name FROM information_schema.columns
--   WHERE table_name = 'custom_statuses' AND column_name = 'updated_at';
--
-- PASSO 1 — INSPECIONAR (rode, leia, NAO altere ainda). 'A Fazer' pode ser:
--   (a) o status de SISTEMA (sufixo TODO) — varias rows USR_<id>_TODO com label 'A Fazer'; OU
--   (b) um label CUSTOM de algum usuario (key USR_<id>_A_FAZER).
--   Veja os dois angulos:
--   SELECT key, label, color, position FROM public.custom_statuses
--   WHERE label ILIKE 'A Fazer' ORDER BY key;
--   SELECT key, label FROM public.custom_statuses WHERE key LIKE '%\_TODO' ORDER BY key;
--   -- Avalie: quantas rows? label exatamente 'A Fazer'? renomear TODAS ou so um escopo?
--   -- DEDUP POR LABEL: o front deduplica sections de sistema POR LABEL (ops-store.ts:311).
--   --   Se renomear PARCIALMENTE as rows TODO, a UI mostra 'A Fazer' e 'Lembrete' como
--   --   DUAS sections. Para sistema, renomeie TODAS de uma vez (Opcao A).
--
-- PASSO 2 — RENOMEAR (descomente APENAS a clausula que casa com o PASSO 1; ajuste
--           updated_at conforme o PASSO 0):
--
--   -- Opcao A: por LABEL exato (renomeia todas as rows com esse label):
--   -- UPDATE public.custom_statuses
--   --   SET label = 'Lembrete' /*, updated_at = now() */
--   --   WHERE label = 'A Fazer';
--
--   -- Opcao B (cirurgica): so a key completa que voce viu no PASSO 1:
--   -- UPDATE public.custom_statuses
--   --   SET label = 'Lembrete' /*, updated_at = now() */
--   --   WHERE key = 'USR_<idSemHifens>_TODO';   -- troque pelo valor real
-- #############################################################################