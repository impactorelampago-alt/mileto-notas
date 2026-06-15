# Mileto Notas — Documentação Técnica Completa

> Bloco de notas colaborativo desktop (Electron) — extensão do Mileto Ops sobre banco Supabase compartilhado.

**Data:** 14/06/2026 · **Versão do app:** `1.3.8` (`package.json` → `ops-notas`)

---

## Sumário

1. [Visão geral](#1-visão-geral)
2. [Stack tecnológica](#2-stack-tecnológica)
3. [Arquitetura](#3-arquitetura)
4. [Modelo de dados e integração com o Ops](#4-modelo-de-dados-e-integração-com-o-ops)
5. [Autenticação e impersonação](#5-autenticação-e-impersonação)
6. [Recursos / funcionalidades](#6-recursos--funcionalidades)
7. [Sincronização em tempo real e reconciliação](#7-sincronização-em-tempo-real-e-reconciliação)
8. [Persistência local e salvar-ao-fechar](#8-persistência-local-e-salvar-ao-fechar)
9. [Auto-update in-app](#9-auto-update-in-app)
10. [Banco de dados — objetos do Notas](#10-banco-de-dados--objetos-do-notas)
11. [Sincronização com o Ops na prática + estado atual do banco (jun/2026)](#11-sincronização-com-o-ops-na-prática--estado-atual-do-banco-jun2026)
12. [Build, empacotamento e release](#12-build-empacotamento-e-release)
13. [Limitações e pendências conhecidas](#13-limitações-e-pendências-conhecidas)
14. [Mapa de arquivos](#14-mapa-de-arquivos)

---

## 1. Visão geral

O **Mileto Notas** (interno: `ops-notas`) é um app desktop de bloco de notas colaborativo, no estilo do Bloco de Notas do Windows 11, construído em Electron + React. Ele **não é um produto isolado**: é uma **extensão do Mileto Ops** (a ferramenta de gestão/kanban da agência) e **opera sobre o MESMO banco** — uma instância Supabase self-hosted em `https://supabase.miletoops.com`.

**Princípio do banco compartilhado.** O Notas não possui banco próprio. Ele lê e escreve nas mesmas tabelas que o app web do Ops (`tasks`, `custom_statuses`, `clients`, `profiles`) e adiciona, de forma **aditiva e idempotente**, um conjunto de tabelas, funções, policies e triggers com prefixo `notas_`/`note_` que apenas o Notas usa. A consequência operacional fundamental: **toda e qualquer alteração no Notas que toque o banco/integração precisa ser pensada para andar em sincronia com o Ops** (schema, RLS, status keys, prioridades, conclusão de tarefas). Em especial, o helper de identidade de status (`status-keys.ts`) deve ser idêntico byte-a-byte nos dois apps.

**Relação 1:1 com o Ops.** Cada nota do Notas corresponde a exatamente uma `task` do Ops (`notes.task_id`), e cada "categoria" do Notas é uma "section/coluna" do Ops (uma linha de `custom_statuses`). Criar, editar, priorizar e concluir notas reflete diretamente no kanban do Ops. Já o compartilhamento, as notificações do sino e as mídias por nota vivem em objetos exclusivos do Notas e **não** refletem no Ops.

---

## 2. Stack tecnológica

| Camada | Tecnologia | Versão (`package.json`) |
|---|---|---|
| Desktop | Electron | `^30.1.0` |
| Bundler | Vite (+ `vite-plugin-electron`, `vite-plugin-electron-renderer`) | `^5.3.3` |
| UI | React + React DOM | `^18.3.1` |
| Linguagem | TypeScript | `^5.5.3` |
| Estilo | Tailwind CSS v4 (`@tailwindcss/postcss`) | `^4.0.0` |
| State | Zustand | `^5.0.0` |
| Banco/Auth/Realtime/Storage | Supabase (`@supabase/supabase-js`) | `^2.98.0` |
| Auto-update | `electron-updater` + GitHub Releases | `^6.2.1` |
| Persistência local | `electron-store` | `^8.2.0` |
| Ícones | `lucide-react` | `^0.400.0` |
| Datas | `date-fns` | `^3.6.0` |
| Animações | `framer-motion` | `^11.3.0` |
| Utilidades de classe | `clsx`, `tailwind-merge` | `^2.1.1` / `^2.4.0` |
| Empacotamento | `electron-builder` (target NSIS x64) | `^24.13.3` |

Saída do app empacotado: `"main": "dist-electron/main.js"`.

---

## 3. Arquitetura

### 3.1. Processos Electron

O app segue a separação clássica de Electron:

- **Processo principal (main)** — `electron/main.ts`. Roda em Node.js; controla o ciclo de vida do app, cria a `BrowserWindow`, responde a IPC (controles de janela, persistência local, auto-update). É o único processo com acesso a APIs nativas, disco e `electron-updater`.
- **Processo de renderização (renderer)** — o app React/Vite dentro da janela. Roda com `nodeIntegration: false` e `contextIsolation: true` — sem acesso direto a Node/Electron.
- **Ponte (preload)** — `electron/preload.ts`. Executa num contexto isolado e expõe `window.electronAPI` via `contextBridge.exposeInMainWorld`. É a **única** superfície de comunicação renderer → main. Contrato de tipos em `src/electron.d.ts`.

`webPreferences` da janela: `preload`, `nodeIntegration: false`, `contextIsolation: true`, `sandbox: false` (necessário para o preload usar `require`/`ipcRenderer` ao importar de `electron` e `electron-store`).

### 3.2. Stores Zustand e fluxo de dados

O estado do renderer vive em **9 stores Zustand** independentes (`create<T>()`), sem Context React. Os stores se comunicam imperativamente via `useXStore.getState()`. A fonte de verdade dos dados é o Supabase; camadas de cache local (electron-store e localStorage) são rede de segurança.

Padrões transversais:

- **Atualização otimista**: o estado local muda na hora; em erro de banco, reverte para o snapshot `prev`.
- **Token cacheado em nível de módulo**: `ops-store` e `notes-store` guardam `_cachedToken`/`_notesToken` fora do store React para fazer `fetch` direto na REST do Supabase com timeout via `AbortController` (5 s). Zerados no logout (`clearOpsAuthCache`/`clearNotesAuthCache`).
- **`fetch` direto vs cliente Supabase**: leituras/escritas com timeout controlado usam `fetch` puro (helpers `opsFetch`/`opsPost`/`opsDelete` no ops-store; `notesFetch`/`notesPatch`/`notesDelete` no notes-store). RPCs, Storage, Realtime e operações sem timeout custom usam o cliente `supabase`.

Diagrama do fluxo de dados (texto):

```
                         ┌────────────────────────────────────────────┐
                         │      Supabase self-hosted (compartilhado)    │
                         │  tasks · custom_statuses · clients · profiles│
                         │  notes · note_shares · category_shares ·     │
                         │  note_media · notas_notifications · ...      │
                         └───────────────▲───────────────▲──────────────┘
                            REST/RPC/RT  │               │  Realtime (RLS)
                                         │               │
   ┌─────────────────────────────────────┴───────────────┴─────────────────────┐
   │                              RENDERER (React)                               │
   │                                                                            │
   │  auth-store  ──getEffectiveUserId()──►  decide DE QUEM são os dados        │
   │      │  (signOut reseta todos)                                            │
   │      ▼                                                                    │
   │  ops-store.refreshOpsSnapshot()  ── motor de sync ──►                     │
   │      │   2 queries REST: custom_statuses + tasks                          │
   │      │   ao terminar dispara:                                             │
   │      ├──► notes-store.ensureNotesForOrphanTasks()                         │
   │      └──► notes-store.syncNotesFromTaskDescriptions()                     │
   │                                                                            │
   │  notes-store.loadNotes()  ◄── lê sharing-store + ops-store.tasks          │
   │  sharing-store · notifications-store · media-store ·                      │
   │  collaborators-store · categories-store · ui-store                        │
   │                                                                            │
   │  Camada local invisível:  local-drafts (electron-store) ·                 │
   │                           completed-origins (localStorage)                │
   └────────────────────────────────────────────────────────────────────────┘
                                         │ window.electronAPI (preload bridge)
                                         ▼
   ┌────────────────────────────────────────────────────────────────────────┐
   │   MAIN (Node)  electron/main.ts                                          │
   │   BrowserWindow frameless · IPC (window:* / session:* / update:*) ·      │
   │   electron-store (disco) · electron-updater (GitHub Releases)            │
   └────────────────────────────────────────────────────────────────────────┘
```

**Mapa de interações entre stores:**

- **auth-store** é a raiz: `getEffectiveUserId` decide de quem são os dados (impersonação); `signOut` reseta os demais; `setViewingAs` recarrega notes + ops.
- **ops-store.refreshOpsSnapshot** é o motor de sincronização: após cada snapshot dispara `ensureNotesForOrphanTasks` + `syncNotesFromTaskDescriptions` do notes-store, e lê o sharing-store para trazer sections/tasks compartilhadas.
- **notes-store.loadNotes** lê o sharing-store (notas/categorias compartilhadas) e o ops-store (tasks para resolver `task_id` → status das categorias compartilhadas). `createNote`/`createTaskInOps`/`deleteSection` cruzam notes↔ops.
- O Realtime de `category_shares`/`note_shares` (ops-store → `reconcileShares`) e o `setupAutoReconciliation` (foco/polling) acionam `sharing-store.loadShares` → re-snapshot + re-load de notas.
- **notifications-store** lê auth (uid real, teamProfiles), notes (achar/abrir nota por `task_id`, `completedOrigins`) e ops (sections/tasks).
- **media-store** e **collaborators-store** dependem só de auth + Supabase; **categories-store** e **ui-store** são autônomos.

### 3.3. Camadas de persistência

- **Nuvem (fonte de verdade):** Supabase. Sessão de auth persistida via `electronStorage` customizado (ver §5).
- **Local invisível 1 — rascunhos e sessão:** `electron-store` em disco (`%AppData%/ops-notas`), acessado pela bridge `electronAPI.sessionStorage`. Guarda rascunhos por nota (`local-drafts`) e a sessão de abas (`session-tabs`). Modelo sem relógio: rascunho que sobrevive ao próximo boot = conteúdo que pode não ter chegado à nuvem → restaurado silenciosamente.
- **Local invisível 2 — origens de conclusão:** `localStorage` (chave `notas:completed-origins`), mapa `task_id → status de origem`. Conveniência de exibição; não vai para o banco.

---

## 4. Modelo de dados e integração com o Ops

Fontes: `src/lib/types.ts`, `src/lib/sections.ts`, `src/lib/status-keys.ts`, `src/lib/supabase.ts` e as 8 migrations em `supabase/migrations/`.

### 4.1. Cliente Supabase (`src/lib/supabase.ts`)

- Cria o cliente único `supabase` a partir de `VITE_SUPABASE_URL` e `VITE_SUPABASE_ANON_KEY` (lança erro se faltarem).
- **Persistência de sessão sob medida para Electron:** define um `electronStorage` que, quando existe `window.electronAPI.sessionStorage`, guarda a sessão via bridge (disco do processo principal); senão cai para o `localStorage` do navegador.
- **Config de auth:** `persistSession: true`, `autoRefreshToken: true`, `detectSessionInUrl: false` (não há fluxo OAuth/redirect hoje) e um `lock` customizado que apenas executa `fn()` sem locking real (o lock padrão do supabase-js via Web Locks API não se comporta bem no Electron).

### 4.2. Mapeamento nota ↔ task (1:1) e categoria ↔ custom_status

| Conceito no Notas | Campo / objeto no Ops (banco compartilhado) |
|---|---|
| Conteúdo da nota | `notes.content` ↔ `tasks.description` |
| Título da nota | `notes.title` ↔ `tasks.title` |
| Prioridade da nota | `notes.priority` ↔ `tasks.priority` (`LOW`/`MEDIUM`/`HIGH`/`URGENT`) |
| Categoria/seção da nota | section do Ops = linha de `custom_statuses`; vínculo via `tasks.status` = `custom_statuses.key` |
| Concluir nota | mover `tasks.status` → coluna DONE do dono (vira "Concluído" no kanban do Ops) |

`category_id`: a migration `redesign_notes_system.sql` **removeu a FK** `notes_category_id_fkey` e converteu `notes.category_id` de `UUID` para `TEXT`, porque a categorização real passou a ser a section do Ops (`tasks.status`), não a tabela `note_categories`. O comentário no topo dessa migration afirma que **`note_categories` existe no banco mas NÃO é usada pelo app** (mantida para uso futuro).

### 4.3. Formato canônico da status key e helpers

A identidade de uma categoria/section é a **key** de `custom_statuses`:

```
USR_<32hex_sem_hifens>_<SUFIXO>
```

- `USR_` (4) + UUID do dono **sem hífens** (32 hex) + `_` (1) = **prefixo de 37 chars** (`STATUS_PREFIX_LEN = 37`; `CUSTOM_KEY_PREFIX_LEN = 37`).
- O **SUFIXO** é o restante e **pode conter `_` interno** (`EM_ESPERA_2`, `IN_PROGRESS`, `NOT_DONE`). Por isso derivar por separador é perigoso.
- A key embute o ID do dono → sufixos iguais de donos diferentes **não colidem**; a identidade completa é única por dono. Essa é a base de segurança do compartilhamento por categoria.

**Bug histórico (resolvido em v1.3.5, jun/2026, nos 2 apps).** A derivação antiga usava `split('_').pop()` (quebrava com `_` interno: `EM_ESPERA_2` → `2`); e `createSection` truncava o label em 60 chars enquanto `createTaskInOps` não, fazendo `custom_statuses.key ≠ tasks.status` para labels longos. Resultado: notas/tarefas caíam na categoria errada. A correção foi extrair um **helper canônico idêntico byte-a-byte** nos dois apps, usando **regex + sufixo completo** (`src/lib/status-keys.ts`).

Helpers de `status-keys.ts`:

| Função | Assinatura | O que faz |
|---|---|---|
| `cleanUserId` | `(userId) → string` | Remove hífens do UUID → 32 hex. |
| `buildStatusKey` | `(userId, suffix) → string` | Monta `USR_<idLimpo>_<suffix>`. **Não trunca.** |
| `getStatusBase` | `(key) → string` | Extrai o SUFIXO completo via regex `^USR_[0-9a-fA-F]{32}_(.+)$`, preservando `_` internos. Fallback `split('_').slice(2).join('_')`; trata prefixo legado `CUSTOM_`; keys sem prefixo retornam a própria key. |
| `isDoneStatus` | `(key) → boolean` | `getStatusBase(key) === 'DONE'` — **identidade ESTRITA** (`NOT_DONE` não conta). |
| `isStatusSuffix` | `(key, suffix) → boolean` | `getStatusBase(key) === suffix`. |

Helpers complementares em `sections.ts`:

- `DEFAULT_SECTION_SUFFIX = 'TODO'`, `DEFAULT_SECTION_LABEL = 'Lembrete'`: o status de **sistema TODO é exibido sempre como "Lembrete"** (categoria padrão, não excluível, fallback de abertura).
- `sectionDisplayLabel(suffix, label)`: mapeia `TODO` → "Lembrete"; demais exibem o `label` próprio.
- `ownerPrefixOfKey(fullKey)`: os 37 primeiros chars (`USR_<id>_`) ou `null`.
- `doneKeyForStatus(status)`: a key DONE **do mesmo dono** (`prefixo(37)+'DONE'`) ou `null` — usada no move otimista de `completeNote`.
- `isCustomKeyOwnedBy(fullKey, cleanedUserId)`: `true` se começa com `USR_<cleanedUserId>_`.

**Sistema vs custom:** sistema = sufixos nativos do Ops (`TODO` → "Lembrete", `DONE` → Concluído, além de `IN_PROGRESS`/`IN_REVIEW`/`CANCELLED` em `SYSTEM_SUFFIXES`). Custom = sections criadas pelo usuário, com sufixo arbitrário. Toda key segue o mesmo formato, então a mesma derivação serve para ambos.

### 4.4. Prioridades (`src/lib/note-priority.ts`)

- `NOTE_PRIORITY_ORDER = ['LOW','MEDIUM','HIGH','URGENT']`; rótulos pt-BR; cores alinhadas ao Ops: **Urgente `#ef4444`, Alta `#f97316`, Média `#eab308`, Baixa `#a5b4fc`**.
- `normalizePriority(p)`: retorna o valor se MEDIUM/HIGH/URGENT, senão `'LOW'` (default seguro). Aplicado em todo ponto que lê `priority` de notes/tasks.
- `getNextPriority(p)`: próxima no ciclo (clique que rotaciona prioridade).

### 4.5. Tabelas e colunas

**Compartilhadas com o Ops (o Notas lê/escreve):**

- **`notes`** (`Note` em `types.ts`): `id`, `title`, `content`, `priority` (`NotePriority`), `category_id` (string|null — hoje TEXT), `client_id`, `task_id`, `creator_id`, `is_pinned`, `is_archived`, `created_at`, `updated_at`. Joins opcionais: `creator?`, `collaborators?`. Campos **só do front, nunca da tabela**: `is_shared_with_me?` e `shared_permission?`.
- **`tasks`** (`Task` em `types.ts`): `id`, `title`, `status` (key canônica), `priority` (`NotePriority|null`), `assignee_id`, `client_id`, `due_date`, `created_at`. Migrations também usam `tasks.creator_id`, `tasks.description`, `tasks.updated_at`.
- **`custom_statuses`** (sem interface em types.ts): `key` (PK lógica do vínculo), `label`, `color`, `position`. Fonte das categorias/sections.
- **`clients`** (`Client` em `types.ts`): declara `id`, `name`, `situation_trafego`, `situation_vendas`, `assigned_to`, `created_at`. **Atenção (discrepância confirmada):** o tipo `Client` em `types.ts` está **desatualizado/morto** — o código real (`ConnectModal.tsx`, `AddAnnotationToCompanyModal.tsx`) consulta a coluna **`company`** (não `name`), além de `notes`, `assigned_to_id`, `created_by_id`. Use o código como verdade, não o tipo.
- **`profiles`** (`Profile`): `id`, `email`, `name`, `avatar_url`, `role` (`UserRole`), `created_at`, `updated_at`. `UserRole` = `DONO`, `GERENTE`, `COORDENADOR`, `FUNCIONARIO`, `GUEST`, `GESTOR_TRAFEGO`, `VENDEDOR`, `FINANCEIRO`. Trava de segurança aplicada: UPDATE em `profiles` ganhou `WITH CHECK` impedindo o usuário trocar o próprio `role` (anti auto-promoção a DONO).
- **`note_categories`**: existe mas **não é usada** pelo app.

**Só do Notas (criadas pelas migrations):** ver [§10](#10-banco-de-dados--objetos-do-notas).

---

## 5. Autenticação e impersonação

`src/stores/auth-store.ts` é o store-raiz: define quem é o "usuário efetivo" cujas notas/tasks são carregadas.

**Estado principal:** `user` (usuário REAL autenticado), `profile` (perfil do real, com `role`), `isLoading`, `isAuthenticated`, `teamProfiles` (todos os perfis), `viewingAs` (conta visualizada na impersonação; `null` = própria conta).

**Ações-chave:**

- **`initialize`** — arma uma rede de segurança `setTimeout(6000ms)` que força `isLoading: false` (a tela de carregamento nunca trava); `getSession()`; se há sessão, dispara `loadProfile` em background; registra `onAuthStateChange` para `SIGNED_OUT`/re-login.
- **`signIn`** — `signInWithPassword`; traduz erros do GoTrue para pt-BR (`translateAuthError`).
- **`signOut`** — ponto central de **reset total** (no `finally`, mesmo em falha de rede): zera `viewingAs`/`teamProfiles`, `useCollaboratorsStore.resetStore()`, zera tokens cacheados (`clearNotesAuthCache` + `clearOpsAuthCache`), encerra os canais Realtime (`unsubscribeFromNote` + `unsubscribeFromOpsChanges`) e esvazia os stores notes/ops. (O sino é limpo separadamente, pelo cleanup do `useEffect` em `MainApp` quando `isAuthenticated` vira false — `signOut` não chama `notifications.unsubscribe/clear` diretamente.)
- **`setViewingAs(profile)`** — núcleo da impersonação (front-first): seta `viewingAs`, reseta notes/ops, recarrega `loadNotes()` + `refreshOpsSnapshot('view-switch')`.
- **`getEffectiveUserId`** — `viewingAs?.id ?? user?.id`. É o seletor que `loadNotes` e `refreshOpsSnapshot` usam para decidir de quem são os dados.
- **`canDeleteNote(note)`** — `note.creator_id === user?.id`. **Nunca usa `viewingAs`**: excluir é do dono real.
- **`isCategoryOwner(sectionFullKey)`** — `true` se `role === 'DONO'` OU a key começa com `USR_<meuIdSemHifens>_`.

**Usuário REAL vs efetivo:** operações de **leitura/visualização** (loadNotes, snapshot do Ops, notas compartilhadas) usam `getEffectiveUserId` (respeitam impersonação). Operações de **escrita/identidade** (`createNote`, `createTaskInOps`, `createSection`, `ensureNotesForOrphanTasks`, notificações) usam `user?.id` (real) — nunca criam dados em nome da conta visualizada.

**Como a impersonação funciona no banco (fato central):** ela **NÃO troca o token JWT**. O front mantém a mesma sessão e só muda o filtro de leitura (`?creator_id=eq.<id-visualizado>`), reusando o mesmo token. Logo, `auth.uid()` **continua sendo o DONO**, e ler notas de terceiros depende **exclusivamente** da policy de RLS `notes_select_dono_reads_all` (`USING notas_is_dono()`). Sem essa policy, "trocar de conta" na UI não traria nada.

**Quem pode o quê:** apenas usuários com `role = 'DONO'` enxergam dados de terceiros (via a policy acima). O seletor de conta (`AccountSwitcher`) é exibido a todos, mas a leitura real depende da RLS.

---

## 6. Recursos / funcionalidades

### 6.1. Estrutura geral e roteamento

`src/main.tsx` monta o React em `#root` dentro de `<StrictMode>`. `src/App.tsx` lê `isLoading`/`isAuthenticated`/`initialize` do auth-store: chama `initialize()` no mount; enquanto carrega, mostra splash (logo `animate-pulse` + "Carregando..."); depois, autenticado → `<MainApp/>`, senão → `<Login/>`. O `<UpdateBanner/>` é renderizado **sempre**, fora do condicional. O salvar-ao-fechar é registrado num segundo `useEffect` (ver §8).

### 6.2. Login (`src/pages/Login.tsx`)

Email + senha sobre fundo escuro com `<Particles/>` (canvas: 50 partículas brancas semitransparentes que sobem com oscilação senoidal). Controles de janela próprios (frameless): Minimizar/Maximizar/Fechar via `electronAPI.window.*`. Campo de senha com botão olho (`Eye`/`EyeOff`). Validação local (campos vazios → "Preencha o email e a senha."); `signIn(email, password)`; durante a chamada o botão vira "Entrando...". O formulário usa `noValidate` e submete com **Enter**.

### 6.3. Layout principal (frameless / titlebar custom) — `src/pages/MainApp.tsx`

A janela é **sem moldura** (`frame: false`, `titleBarStyle: 'hidden'`). Árvore: `<Titlebar/>` → `<TabBar/>` → `<SearchBar/>` (só se `searchBarVisible`) → `<Editor/>` → `<StatusBar/>`. Abaixo, montados condicionalmente, os modais. Janela 1280×800 (mín. 800×600), `backgroundColor: '#1e1e1e'`, `show: false` até `ready-to-show`. Links externos abrem no navegador padrão (`setWindowOpenHandler` → `shell.openExternal`).

Efeitos de inicialização: ao autenticar, carrega categorias, notas com colaboradores e perfis; encadeia `loadShares()` → `loadNotes()` → `scheduleOpsRefresh('shares-loaded')` (os mapas "compartilhado-comigo" precisam estar prontos antes de montar notas/seções); inicia Ops sync (`loadOpsData`, `subscribeToOpsChanges`, `setupAutoReconciliation`) e o sino (`loadNotifications` + `subscribe`). Garante sempre uma categoria ativa (última usada, ou "Lembrete", ou a primeira). Restaura rascunhos locais na abertura e abre a última nota da categoria ativa (ou cria uma "Sem título"). Assina o Realtime da nota ativa.

> **`MenuBar.tsx` existe mas NÃO é montado.** A seleção de categoria real vive no titlebar (`CategorySelect`).

### 6.4. Titlebar (`src/components/layout/Titlebar.tsx`)

Barra de 40px (`#1a1a1a`). Esquerda: logo + "Mileto Ops Notas" + `<CategorySelect/>`. Direita: `<NotificationBell/>` + `<AccountSwitcher/>` + botão **busca** (`Search`, `title="Buscar (Ctrl+K)"` → `setShowQuickSearch(true)`) + 3 controles de janela (Minimizar/Maximizar/Fechar via `electronAPI.window.*`; `isMaximized` sincronizado por `window:isMaximized` e no `resize`).

### 6.5. Categorias / sections (`CategorySelect.tsx`)

Dropdown no titlebar que lista as categorias (= sections do Ops), troca a ativa, cria, renomeia, exclui e compartilha. Botão-gatilho mostra bolinha de cor + label + chevron. `counts` conta notas por categoria com a regra "concluída conta na origem". Cada linha: acento esquerdo (emerald se ativa; verde contínuo se compartilhada comigo, com badge "Compartilhada"); ações no hover só se `canManage` (dono + custom + não-compartilhada-comigo): Compartilhar (`Users`), Renomear (`Pencil`, inline Enter/Escape/blur), Excluir (`Trash2` → `DeleteSectionModal`). Categorias de sistema são fixas. **Criar categoria**: input + 8 cores (`SECTION_COLORS`) + toggle **Privada/Compartilhada**; se "compartilhada", abre o `SharePickerModal` automaticamente.

`SECTION_COLORS` (8): `#3b82f6, #10b981, #ef4444, #f59e0b, #8b5cf6, #ec4899, #f97316, #06b6d4`.

No store (`categories-store.ts`) há ainda CRUD de `note_categories` (tabela própria isolada por usuário) — mas, como `note_categories` não é usada na categorização atual, essa store é tangencial.

### 6.6. Notas e abas (`TabBar.tsx`)

Peça central da navegação, estilo Bloco de Notas do Windows 11. Mostra as abas (notas) da **categoria ativa**; nota nova entra à direita. Altura 38px.

- **Montagem (`taskToSectionMap`):** mapeia cada task → sufixo de section. Nota **concluída** fica na categoria de **ORIGEM** (`completedOrigins[task.id]`), não no DONE — não some ao concluir. Casamento primeiro pela **key completa**; fallback por sufixo só para categorias de SISTEMA.
- **Cada aba:** largura 132–210px; faixa de prioridade (stripe de 2px animado por `layoutId="activeTabStripe"`); bolinha de urgência (clique abre menu de prioridade); pin (se `is_pinned`); título (`note.title || 'Sem título'`; se concluída, cinza + riscado); ícone de colaboração (`Users` verde) se tem colaboradores / foi compartilhada por mim / é compartilhada comigo; **✓ Concluir/Reabrir** (toggle — só se `canComplete`); **✗ Excluir** (só se `canDeleteNote`).
- **Interações:** clique = `openTab`+`setActiveTab`; duplo-clique = renomear inline (Enter/Escape/blur); botão-direito = context menu (Concluir/Reabrir, Renomear se dono/EDIT, Compartilhar só dono → `SharePickerModal`, Excluir só dono).
- **Botão "+"**: cria nota "Sem título" na categoria ativa. **Auto-criar**: se a categoria ativa fica sem nenhuma nota, após 400ms cria uma vazia (uma tentativa por categoria; **não** durante impersonação).
- **Menu de urgência**: URGENT/HIGH/MEDIUM/LOW; selecionar → `updateNote(id, { priority })` (sincroniza com `tasks.priority`).
- **Chip "Sair"** (`LogOut`) → `signOut()`. É o **único gatilho de logout alcançável** na UI atual (o "Sair" do MenuBar não é montado).
- Estado vazio: "Escolha uma categoria no topo".

**Título = 1ª linha; salvar local + nuvem:** o título de cada nota é derivado da primeira linha do conteúdo (ver Editor, §6.10). Toda edição grava rascunho local imediato e persiste na nuvem via debounce.

#### Lógica de dados (notes-store.ts)

- **`loadNotes`** carrega e mescla 3 conjuntos: (1) próprias/da conta visualizada (`creator_id=eq.<effectiveUserId>&is_archived=eq.false`); (2) notas compartilhadas comigo diretamente (só fora de impersonação, via `sharedWithMeNotes`); (3) notas de categorias compartilhadas comigo (resolve `task_id` via tasks cujo `status` é uma key compartilhada). Dedup por `id` (próprias têm prioridade), normaliza prioridade, e **preserva edição local**: se `local.updated_at > note.updated_at`, mantém `content`/`title`/`updated_at` locais (senão um reload sobrescreveria o que está no debounce de save). Anexa flags `is_shared_with_me`/`shared_permission` quando aplicável.
- **`ensureNotesForOrphanTasks`** cria nota vazia para tasks do usuário sem nota (idempotente via `upsert onConflict: 'task_id', ignoreDuplicates: true`). Guard-rails: não roda em impersonação, usa `user?.id` real, espera `hasLoadedOnce`, respeita `_deletionInProgress`.
- **`syncNotesFromTaskDescriptions`** sincroniza task→nota **apenas quando a task é mais nova** (`taskNewer = task.updated_at > note.updated_at`); se `!taskNewer`, **não sobrescreve** (trava `[grave]` que evita apagar edição local em cada refresh).
- **`createNote`** (otimista): cria a task primeiro (`createTaskInOps`; se falhar, aborta), insere nota otimista no topo + abre aba, depois insere a nota real vinculada ao `task_id`; reverte em erro.
- **`updateNote`** (edição + sync + rascunho): bloqueia se compartilhada-comigo sem EDIT; otimista; grava rascunho local imediato; `notesPatch('notes', ...)` (reverte em falha); remove rascunho em sucesso; **sync nota→task independente** (PATCH em `tasks` mapeando content/title/priority; se falhar por RLS, não reverte a nota).
- **`deleteNote`**: liga `_deletionInProgress`; ordem (1) deleta a task (checa `count === 0` = bloqueio por RLS → aborta), (2) deleta a nota, (3) atualiza UI.
- **Abas/seletores:** `openTab`/`closeTab`/`setActiveTab`/`getNotesByCategory`/`getActiveNote`/`fetchNoteById`/`loadNotesWithCollaborators`. (`closeAllTabs` existe mas é órfão — nenhum componente o chama.)

### 6.7. Concluir / reabrir (toggle)

`completeNote(noteId)`: chama a RPC **`notas_complete_task`** (`SECURITY DEFINER`, valida acesso no banco — funciona para dono e destinatário); otimista, move a task local para o DONE do dono (`doneKeyForStatus`); agenda `scheduleOpsRefresh('task-completed')`.

`toggleComplete(noteId)` (o ✓ da aba): decide por `isDoneStatus(task.status)`.
- **Concluir:** guarda a origem (`completedOrigins[taskId] = task.status`, persiste em localStorage) e delega a `completeNote`. A nota **continua visível na categoria de origem** (não some); fica com ✓ verde e título riscado.
- **Reabrir:** otimista (`optimisticTarget = savedOrigin ?? prefixo+'TODO'`), remove a origem, chama a RPC **`notas_reopen_task(p_task_id, p_target_status)`**; em erro, reverte tudo.

> Histórico: o PATCH direto antigo afetava 0 linhas para o colaborador (RLS) e "mentia" sucesso — por isso reabrir virou RPC. (O JSDoc de `toggleComplete` no código ainda está desatualizado mencionando "patch direto"; o corpo usa a RPC.)

### 6.8. Compartilhamento (categorias e notas — VIEW/EDIT)

Exclusivo do Notas (`sharing-store.ts`); **não reflete no Ops**. Fonte primária: `note_shares`/`category_shares` no Supabase; fallback: cache local (electron-store) — a feature degrada sem erro se o pacote SQL ainda não estiver aplicado.

Estado: `categoryShares`/`noteShares` (o que EU compartilhei), `sharedWithMeNotes`/`sharedWithMeCategories` (o que OUTROS compartilharam comigo, com permissão).

- **`loadShares`**: o que eu compartilhei (`shared_by = uid`, com fallback local); compartilhado comigo **só fora de impersonação** (`shared_with = uid`). `note_shares` carrega `permission`; categoria hoje assume EDIT.
- **`setNoteShare`/`setCategoryShare`**: otimista + delete-then-insert no banco (lista vazia = revogar). Falha de banco → permanece no cache local.

UI: o **`SharePickerModal`** é o único caminho de compartilhamento alcançável (multi-seleção de pessoas; para nota há toggle Edição/Leitura; categoria é sempre EDIT). Aberto pelo context menu da aba (nota) ou pelo CategorySelect (categoria).

### 6.9. Mídias por nota (`media-store.ts` + `NoteMediaStrip.tsx`)

Arquivos vão para o bucket **privado** `note-media`; metadados para `note_media`. Exibição via **signed URLs** (`SIGNED_TTL = 2h`, renovadas a cada 90 min e na hora de copiar). Quem acessa a nota vê; quem edita pode anexar.

- **Formatos:** png, jpeg/jpg, gif, webp, avif. **SVG é excluído de propósito** (a cópia via `createImageBitmap`+canvas falha com SVG).
- **`uploadFiles`**: filtra por MIME; `path = <noteId>/<uuid>.<ext>`; upload + insert em `note_media`; se o insert falhar, remove o arquivo órfão do Storage.
- **`copyMedia`**: re-assina sempre na hora (URL pode ter expirado), faz fetch do blob e `copyImageToClipboard` (rasteriza para PNG via canvas).
- **UI:** thumbnails 76px no rodapé do editor; dropzone tracejado quando vazio com permissão ("Arraste, cole (Ctrl+V) ou clique"); hover mostra Copiar (feedback "Copiado!"/"Falha ao copiar") e Excluir; placeholders de upload em curso; lightbox (overlay escuro, imagem até 88vw/80vh, botão "Copiar imagem"). Colar imagem no editor (Ctrl+V) também envia para cá.

### 6.10. Editor de texto (`Editor.tsx`)

Textarea monospace (`JetBrains Mono`, cor `#cccccc`, fundo `#2d2d2d`, `spellCheck=false`), números de linha opcionais (coluna 52px, off por padrão), autossalvamento, auto-título e fileira de mídias embaixo.

- **Read-only** (`isReadOnly`): nota compartilhada comigo sem EDIT — suprime edição/salvamento/colar/menu de anotação.
- **Autossalvamento** (`handleChange`): `saveState='saving'`, **debounce 500ms** → `updateNote(id, { content })` → `saved` → `idle` após 1500ms.
- **Auto-título (1ª linha = título)**: **debounce 600ms**, primeira linha não-vazia cortada em 60 chars (ou "Sem título").
- **Troca de nota**: antes de trocar, salva conteúdo E título da nota anterior (os debounces são cancelados na troca) — corrige o bug de "texto/título somem ao trocar de aba rápido". Save final no unmount.
- **Colar imagem** (`handlePaste`, Ctrl+V): se o clipboard tem imagem, `preventDefault` e `uploadFiles` em vez de colar como texto.
- **Menu de contexto (seleção de texto)**: "Adicionar trecho à empresa" → `AddAnnotationToCompanyModal`.
- **Cursor/Ln,Col**: `updateCursor` atualiza o StatusBar.
- Estado vazio: ícone `NotebookPen`, "Ops Notas", dica "Ctrl+N para criar uma nota" (texto informativo — ver nota de atalhos em §6.16).
- Ouve eventos de janela `force-save` e `select-all` (preparado para menu nativo, mas **sem emissor** hoje — ver §6.16).

### 6.11. Sino de notificações (`NotificationBell.tsx` + `notifications-store.ts`)

Sino próprio do Notas, independente do sino do Ops. **Sempre do usuário REAL** (`user?.id`), nunca de `viewingAs`. Lê `notas_notifications` (limite 50, ordenado por `created_at` desc). Dois tipos:

- **`task_completed`** (`CheckCircle2` verde, "concluiu:") — quando alguém que não é o criador conclui uma tarefa.
- **`note_created`** (`FilePlus2` azul, "adicionou uma nota:") — quando alguém cria nota numa categoria compartilhada.

UI: badge vermelho com contagem de não-lidas (">9" vira "9+"); botão "Marcar lidas" (`markAllRead`); cada item mostra ator (resolvido por `resolveActorNames`) + verbo + título + tempo relativo (`timeAgo`); clicar → `openNotification` (acha a nota local por `task_id`, calcula o status efetivo respeitando a origem de conclusão, casa **sempre por key completa**, abre a aba). Realtime: canal `notas_notif:<uid>` (INSERT filtrado por `recipient_id`).

### 6.12. Busca rápida (`QuickSearch.tsx`)

Command-palette ancorada no topo-direito, aberta por **Ctrl+K** ou pelo botão de busca. Sem query mostra as 20 primeiras notas; com query filtra por título OU conteúdo (case-insensitive, limite 20). Cada resultado: ícone, título, preview (80 chars) e a categoria da nota. Selecionar troca para a categoria, ativa e abre a aba. Atalhos: ↓/↑ navegam, Enter abre, Esc fecha. É a busca funcional do app.

### 6.13. Seletor de conta: "Todos", própria conta e impersonação (`AccountSwitcher.tsx`)

Avatar (`avatar_url` ou inicial). Dropdown "Trocar de conta": primeiro item = você (check se não impersonando, clicar → `choose(null)`); demais = `others` (todos menos você), com cargo (`ROLE_LABELS`) e check no atual, clicar → `setViewingAs(p)`. `ROLE_LABELS`: DONO→Dono, GERENTE→Gerente, COORDENADOR→Coordenador, FUNCIONARIO→Funcionário, GUEST→Convidado, GESTOR_TRAFEGO→Gestor de Tráfego, VENDEDOR→Vendedor, FINANCEIRO→Financeiro.

**Modo "Todos" (v1.3.6 — espelha o Mileto Ops).** No topo do dropdown, só para cargos de gestão (`DONO`/`GERENTE`/`COORDENADOR`), aparece **"Todos · Visão geral de toda a equipe"**. Estado em `auth-store`: `viewAll: boolean` + `setViewAll(on)` (entra/sai do modo, sai da impersonação, reseta e recarrega). Quando ativo:
- **`ops-store.refreshOpsSnapshot`** busca TODAS as tasks (sem filtro `or=` — a RLS já libera o dono/gestão a ler tudo) e monta as seções deduplicadas por **sufixo** (uma "Lembrete", uma "Em Progresso"…).
- **`notes-store.loadNotes`** busca TODAS as notas (sem filtro `creator_id`); `ensureNotesForOrphanTasks` é **pulado** (senão criaria nota do dono pra cada task da equipe).
- **`TabBar`/`CategorySelect`** casam tarefa↔seção por **sufixo** (`getStatusBase`), agregando o "Lembrete" de todo mundo num só, etc.
- É **somente leitura**: `Editor` fica read-only; criar nota (botão "+" / auto-criar), concluir (✓), excluir (✗), menu de contexto e gerenciar/criar categoria ficam **escondidos**. (Editar nota de terceiro exigiria outra policy de UPDATE; o "ver só o meu" continua sendo a própria conta.)

### 6.14. Barra de status (`StatusBar.tsx`)

Rodapé (~28px, `h-7`, fundo `#1a1a1a`), só se `showStatusBar`. Esquerda: "Ln {linha}, Col {coluna}". Centro: "{N} caracteres". Direita: indicador de salvamento ("Salvo"/"Salvando…") + "UTF-8" + "Quebra: On/Off".

### 6.15. Modais

Padrão comum: overlay `rgba(0,0,0,.6)` com blur, fecham ao clicar no fundo e com **Esc**, card escuro arredondado.

| Modal | Função | Acessível na UI atual? |
|---|---|---|
| `SharePickerModal` | Compartilhar categoria/nota (multi-seleção; nota tem Edição/Leitura) | **Sim** (context menu da aba; CategorySelect) |
| `QuickSearch` | Busca rápida de notas | **Sim** (Ctrl+K; titlebar) |
| `CategoryModal` | Criar/editar categoria genérica (8 cores) | Montado (criar/editar via ui-store) |
| `DeleteNoteModal` | Confirmar exclusão de nota | **Sim** (via fluxo de exclusão) |
| `DeleteSectionModal` | Excluir section, avisando quantas tarefas/notas serão apagadas | **Sim** (CategorySelect) |
| `ClientAnnotationsModal` | Listar anotações de uma empresa (`note_client_annotations`, só leitura) | **Sim** (de dentro do ConnectModal) |
| `AddAnnotationToCompanyModal` | Salvar trecho selecionado no campo `notes` de uma empresa (append) | **Sim** (menu de contexto do Editor) |
| `ConnectModal` | Conectar nota a Empresa (`clients.company`) ou Tarefa do Ops | **Não** — montado, sem gatilho `setShowConnectModal(true)` |
| `CollaboratorsModal` | Colaboradores via `note_collaborators` (VIEW/EDIT) | **Não** — sem gatilho |
| `SharedNotesModal` | "Notas compartilhadas comigo" via `note_collaborators` | **Não** — sem gatilho |
| `AssignCategoryModal` | Atribuir `category_id` local à nota | **Não** — `setAssignCategoryNoteId` só é chamado com `null` |
| `InputModal` | Entrada de texto genérica | **Não montado** |
| `MenuBar` | Accordion de categorias + "Sair" | **Não montado** |

> **Quatro modais órfãos** (`ConnectModal`, `CollaboratorsModal`, `SharedNotesModal`, `AssignCategoryModal`) estão montados em `MainApp` mas **não têm gatilho de abertura** na UI atual. O compartilhamento real passa só pelo `SharePickerModal` (note_shares/category_shares), não pelo `CollaboratorsModal` (note_collaborators, fluxo legado).

### 6.16. Atalhos de teclado

| Atalho | Onde | Origem | Ação |
|---|---|---|---|
| **Ctrl+K** | Global (app) | `MainApp.tsx` `keydown` | Abre o QuickSearch |
| **Enter** | Login | `<form onSubmit>` | Submete login |
| **Esc** | Modais | cada modal | Fecha |
| **Enter** | CategoryModal/InputModal | `keydown` (texto não-vazio) | Confirma |
| **Enter / Esc / blur** | Renomear aba/categoria, criar categoria | inputs inline | Confirma / cancela / confirma |
| **↑ / ↓ / Enter / Esc** | QuickSearch | `handleKeyDown` | Navegar / abrir / fechar |
| **Ctrl+V (imagem)** | Editor | `handlePaste` | Cola imagem do clipboard como mídia anexa |

> **Ctrl+N / Ctrl+S / Ctrl+A não têm emissor hoje.** Não há `Menu` nativo nem `globalShortcut` em `electron/main.ts`, e o preload não expõe `force-save`/`select-all`/`new-note`. O Editor está preparado para recebê-los, mas nada os dispara. Criar nota é via botão "+" do TabBar; salvar é automático por debounce. **Ctrl+K é o único atalho global JS de fato implementado.**

### 6.17. Estilo visual (`src/globals.css`)

Tema "Windows 11 Notepad Dark" (variáveis em `:root`, confirmadas no arquivo):

| Variável | Valor |
|---|---|
| `--color-bg-primary` | `#1e1e1e` |
| `--color-bg-secondary` | `#2d2d2d` |
| `--color-bg-tertiary` | `#333333` |
| `--color-bg-tab-active` | `#2d2d2d` |
| `--color-bg-tab-bar` | `#252526` |
| `--color-border` | `#3d3d3d` |
| `--color-text-primary` | `#cccccc` |
| `--color-text-secondary` | `#969696` |
| `--color-text-muted` | `#6d6d6d` |
| `--color-accent` | `#10b981` |
| `--color-accent-hover` | `#059669` |

Fontes: UI = `Segoe UI Variable Text`/`Segoe UI`/system (14px); editor e números de linha = `JetBrains Mono` (Google Fonts). `html/body/#root { height:100%; overflow:hidden }`, `body { user-select:none }`. `.titlebar-drag`/`.titlebar-no-drag` controlam `-webkit-app-region`. Scrollbars custom (3px nas abas, thumb verde `#1a7a2e`). `@media (prefers-reduced-motion: reduce)` zera animações. Animações Framer Motion: stripe da aba ativa (`layoutId`, spring), bolinha de urgência (`whileTap` scale 1.3), SearchBar fade+slide, lightbox fade+scale, UpdateBanner spring.

> **SearchBar (`SearchBar.tsx`):** visualmente completo (buscar/substituir, "Aa", navegação) mas **a lógica de busca/realce/substituição ainda não está ligada** (contador fixo "0 de 0", botões sem handler). A busca funcional é o QuickSearch.

---

## 7. Sincronização em tempo real e reconciliação

`ops-store.ts` centraliza a sincronização do lado Ops (sections = `custom_statuses`; tasks).

- **`refreshOpsSnapshot(reason)`** é o refresh canônico (reentrante via `_isRefreshing`/`_pendingRefresh`). Usa o usuário efetivo (`getEffectiveUserId`) e faz **duas queries REST em paralelo**: `custom_statuses?select=label,color,key,position&order=position.asc` e `tasks?...&or=(status.like.USR_<cleanedUserId>_*,assignee_id.eq.<userId>)`. Monta as sections (sistema deduplicado por label; custom só se a key contém meu id), adiciona sections/tasks compartilhadas comigo (só fora de impersonação), preserva `activeSectionId`, e ao final dispara `ensureNotesForOrphanTasks` + `syncNotesFromTaskDescriptions`.

  > **Importante:** apesar de um comentário JSDoc desatualizado (`ops-store.ts:275`) citar a RPC `get_ops_snapshot`, **o front NÃO chama essa RPC** — usa as duas queries REST acima. A RPC `get_ops_snapshot` existe na migration mas é **código morto do ponto de vista do app**.

- **`scheduleOpsRefresh(reason)`**: debounce de 300ms que consolida múltiplos eventos.
- **`subscribeToOpsChanges`** (canal `ops-changes`): handlers são gatilhos puros — `tasks`/`custom_statuses` → `scheduleOpsRefresh`; `category_shares`/`note_shares` → `reconcileShares` (recarrega `loadShares()` → `refreshOpsSnapshot` + `loadNotes()` para o compartilhamento aparecer na hora). O Realtime respeita RLS (só chegam linhas visíveis). Em `CHANNEL_ERROR`, re-subscreve em 5s.
- **`setupAutoReconciliation`**: em foco/visibilidade (`visibilitychange` → `visible`) recarrega shares + snapshot + notas; **polling de 10s** chama `refreshOpsSnapshot('polling-10s')`.
- **Realtime por-nota** (`subscribeToNote` no notes-store): canal `note:<id>` (UPDATE filtrado por `id`); só aplica se `updated.updated_at > localNote.updated_at` (não regride).

---

## 8. Persistência local e salvar-ao-fechar

Camada local invisível (estilo Bloco de Notas do Windows 11):

- **`local-drafts.ts`** (electron-store via `electronAPI.sessionStorage`): `NoteDraft = {content, title, savedAt}`. Ao editar, grava rascunho; quando a nuvem confirma, remove. Rascunho que sobrevive ao próximo boot = conteúdo possivelmente não sincronizado → restaurado silenciosamente. `saveSession`/`loadSession` (mapa `session-tabs`) restauram abas e seção ativa entre sessões. Todas as funções são try/catch silencioso — o backup local nunca pode quebrar o app.
  - **Offline → nuvem (v1.3.7):** se o save na nuvem falha (sem rede), o `updateNote` **não reverte** mais a edição na tela — ela fica visível e o rascunho local fica pendente. O `notes-store.flushPendingDrafts()` re-envia os rascunhos pendentes pra nuvem **assim que a conexão volta** (listener do evento `online` + foco da janela, em `MainApp`), sem precisar reabrir o app. A nuvem permanece como fonte de verdade (rascunho é descartado ao confirmar o save).
- **`completed-origins.ts`** (localStorage, chave `notas:completed-origins`): mapa `task_id → status de origem` para manter a nota concluída visível na categoria de origem. Não vai para o banco.

**Salvar ao fechar (graceful close):** `App.tsx` registra `electronAPI.onBeforeClose`. Quando o Electron pede para fechar: (1) rede de segurança LOCAL primeiro — `saveSession(...)` + `saveDraft(...)` por aba (rápido, invisível); (2) sincroniza com a nuvem (best-effort) via `updateNote` por aba; (3) no `finally` chama sempre `electronAPI.closeApp()` — o app SEMPRE fecha mesmo se os saves falharem. No main, o evento `close` é interceptado (`preventDefault`), dispara `app:before-close` e arma um **timer de fallback de 7s** (fecha à força se o renderer não confirmar via `app:close-ready`).

---

## 9. Auto-update in-app

`electron-updater` no main + `UpdateBanner.tsx` no renderer. Modelo **não-intrusivo**: não baixa sozinho; avisa no app e instala com 1 clique (decisão histórica da v1.3.1, depois que o auto-update antigo baixava mas não instalava).

- **Config:** `autoDownload = false` (download só ao clicar "Instalar atualização"); `autoInstallOnAppQuit = true` (rede de segurança).
- **Checagem inicial:** `setTimeout(3000)` após `app.whenReady` → `checkForUpdates()` (erros em dev/sem release ignorados).
- **Eventos → IPC:** `update-available` → `update:available` `{version}`; `download-progress` → `update:progress` `{percent}`; `update-downloaded` → `update:downloaded`; `error` → `update:error` `{message}`. Repassados por `sendToRenderer`.
- **Pedido do usuário** (`ipcMain.on('update:install')`): marca `userRequestedInstall = true` e chama `downloadUpdate()`.
- **Após download** (`update-downloaded`): avisa o renderer (banner → "Instalando…") e, se `userRequestedInstall`, marca `pendingInstall = true` e dispara `app:before-close` (reusa o fluxo de salvar). Fallback `setTimeout(7000)` → `doInstall()`.
- **`doInstall`**: idempotente (`installing`), seta `isForceClose = true` (senão o quit trava no guard de `close`), limpa o timer, `quitAndInstall(true, true)` (silencioso + reabre).
- **Banner (`UpdateBanner.tsx`):** máquina de estados `idle | available | downloading | installing | error`; barra de progresso emerald em `downloading`; botão "Instalar atualização" (`available`) / "Tentar de novo" (`error`); canto inferior direito, entrada com spring.

**Sequência feliz:** abre → 3s → `checkForUpdates` → versão nova → banner "available" → clique → `update:install` → `downloadUpdate` → progresso → `update-downloaded` → salva via `app:before-close` → `doInstall` → `quitAndInstall` → instala e reabre.

---

## 10. Banco de dados — objetos do Notas

Todos criados de forma **aditiva e idempotente** com prefixo `notas_`/`note_`, para nunca colidir com objetos do Ops.

### 10.1. Tabelas só do Notas

- **`note_client_annotations`** (`add_note_priority_and_client_annotations.sql`): `id`, `note_id` (FK `notes` CASCADE), `client_id` (FK `clients` CASCADE), `excerpt`, `selection_start`, `selection_end`, `created_by` (FK `auth.users` CASCADE), `created_at`. RLS: SELECT/INSERT = criador da nota ou colaborador; DELETE = próprio `created_by`.
- **`note_collaborators`** (fluxo legado, separado de `note_shares`): `id`, `note_id`, `user_id`, `permission` (VIEW/EDIT), `added_by`, `created_at`.
- **`note_shares`** (`rls_sharing_and_impersonation.sql`): `id`, `note_id` (FK `notes` CASCADE), `shared_with`, `shared_by`, `permission` (VIEW/EDIT, default VIEW), `created_at`. Único `(note_id, shared_with)`; índices em `shared_with`/`note_id`/`shared_by`.
- **`category_shares`**: `id`, `category_key` (text — **KEY COMPLETA**, casa por igualdade exata com `tasks.status`), `shared_with`, `shared_by`, `created_at`. Único `(category_key, shared_with)`. (Coluna `permission` opcional não aplicada por padrão; hoje compartilhar categoria implica EDIT.)
- **`notas_notifications`** (`notas_notifications.sql`): `id`, `recipient_id` (FK `profiles` CASCADE), `actor_id` (FK `profiles` SET NULL), `task_id` (uuid, **sem FK**), `note_id` (uuid, sem FK), `title` (default `''`, snapshot), `type` (default `'task_completed'`), `created_at`, `read_at`. Índice `(recipient_id, read_at, created_at desc)`.
- **`note_media`** (`note_media_and_shared_note_notify.sql`): `id`, `note_id` (FK `notes` CASCADE), `storage_path`, `mime_type` (default `'image/png'`), `filename`, `created_by` (FK `profiles` SET NULL), `created_at`. Índice `(note_id, created_at)`.

### 10.2. Funções, RPCs e policies

**Helpers SECURITY DEFINER (`notas_*`, search_path travado, anti-recursão de RLS):**

- `notas_is_dono()` — TRUE se `profiles.role = 'DONO'`.
- `notas_can_share_note(note_id)` — criador/colaborador OU DONO.
- `notas_owns_category_key(category_key)` — dono da key (`USR_<id>_`) OU DONO.
- `notas_category_shared_with_me(task_id)` — categoria compartilhada comigo, casando por **key COMPLETA** (`cs.category_key = t.status`, igualdade exata — sem `split_part`).
- `notas_can_edit_note(note_id)`, `notas_can_edit_task(task_id)`, `notas_can_complete_task(task_id)` (pacote 2).
- `notas_current_role` (registro CLAUDE.md).

**Policies aditivas PERMISSIVE de SELECT em `notes`** (só ampliam, via OR):

- `notes_select_dono_reads_all` → `notas_is_dono()` — base da impersonação.
- `notes_select_shared_with_me` → existe em `note_shares` com `shared_with = auth.uid()`.
- `notes_select_shared_category` → `notas_category_shared_with_me(task_id)`.

**Policies de edição pelo destinatário (pacote 2):**

- `notes_update_shared_editor` — destinatário com EDIT só muda `title`/`content`/`priority`; o WITH CHECK compara `creator_id`/`task_id`/`category_id`/`client_id`/`is_archived`/`is_pinned` com o valor antigo (trava sequestro/movimentação).
- `tasks_update_shared_editor` — destinatário só edita conteúdo com `status` **IMUTÁVEL** (concluir vai pela RPC).
- `tasks_select_shared_with_me` (condicional).

**RPCs (`SECURITY DEFINER`):**

- **`notas_complete_task(p_task_id)`** — caminho único do "Concluir". Valida via `notas_can_complete_task`, deriva a key DONE do **mesmo dono** (`left(status,37)||'DONE'`, identidade estrita), exige que a key DONE exista em `custom_statuses`, é no-op idempotente se já concluída. `REVOKE ALL FROM public` + GRANT a `authenticated`.
- **`notas_reopen_task(p_task_id, p_target_status)`** — reabrir/desfazer. Default = TODO do mesmo dono; valida mesmo dono + existência em `custom_statuses`; autoriza dono da task OU categoria compartilhada OU nota com EDIT.
- **`notas_complete_task`/`notas_reopen_task`** substituíram o PATCH direto, que afetava 0 linhas para o colaborador e fingia sucesso.
- `get_ops_snapshot()` existe (`get_ops_snapshot.sql`) mas **não é usada pelo front** (código morto). Ainda contém a derivação frágil por `split_part` — não usar para casar sufixos.

**Triggers de notificação (best-effort, `EXCEPTION when others` para nunca abortar a escrita na task):**

- `trg_notas_notify_on_complete` (AFTER UPDATE OF status em `tasks`): status vira o DONE canônico do dono e quem concluiu não é o `creator_id` → insere `task_completed`. Captura conclusões feitas pelo Notas **ou** pelo Ops.
- `trg_notas_notify_on_shared_note` (AFTER INSERT em `tasks`): status = `category_shares.category_key` → avisa cada `shared_with` (exceto criador/ator) com `note_created`.

**Storage:** bucket privado **`note-media`** (`public=false`, limite **25 MB = 26214400 bytes**, MIME só raster: png/jpeg/gif/webp/avif — SVG fora). Caminho `<note_id>/<uuid>.<ext>`. Policies em `storage.objects` espelham o acesso à nota: leitura = nota visível; upload/remoção = `notas_can_edit_note`.

**Realtime:** `notas_notifications`, `category_shares` e `note_shares` adicionadas à publication `supabase_realtime` (idempotente).

**Trava de segurança em `profiles`:** UPDATE ganhou `WITH CHECK` que impede o usuário trocar o próprio `role` (anti auto-promoção a DONO). `profiles.role` é o enum `user_role`.

### 10.3. O que reflete no Ops e o que NÃO

| Ação no Notas | Reflete no Ops? | Por quê |
|---|---|---|
| Criar/editar nota (título, conteúdo, prioridade) | **Sim** | Mesmas `tasks` (`title`/`description`/`priority`). |
| Criar categoria (section) | **Sim** | Mesma `custom_statuses`. |
| Concluir nota | **Sim** | `tasks.status` → DONE do dono; vira coluna "Concluído" no kanban. A task continua existindo. |
| Reabrir nota concluída | **Sim** | `notas_reopen_task` move o status de volta. |
| **Compartilhar nota/categoria** | **NÃO** | `note_shares`/`category_shares` — só do Notas. |
| Sino de notificações | **NÃO** (independente) | `notas_notifications` é exclusivo do Notas. |
| Mídias por nota | **NÃO** hoje | `note_media` + bucket — do Notas. |
| "Concluída de origem" (manter visível) | **NÃO** | localStorage `notas:completed-origins` por `task_id`. |

---

## 11. Sincronização com o Ops na prática + estado atual do banco (jun/2026)

Investigação direta no banco self-hosted (`supabase.miletoops.com` via psql), incorporada aqui — não consta do código.

### 11.1. Equipe (tabela `profiles`)

- **Thales** = DONO (id `8e3759a7-9178-49a5-8d8a-c9fe7d46c4c0`)
- **Arthur**, **Gabriel** = GERENTE
- **Victoria** = COORDENADOR
- **luiz**, **Gustavo**, **Cauã** = GESTOR_TRAFEGO
- **Barbara** = FINANCEIRO
- **Otavio** = VENDEDOR
- **"Super Admin"** (`mileto.apps@gmail.com`) = FUNCIONARIO
- ~190 tasks no total.

### 11.2. Escopo Notas vs Ops — a causa do "vejo 2, o Ops mostra 24"

A Notas é **por usuário por design**: filtra as tasks por `or=(status.like.USR_<id_sem_hifens>_*, assignee_id.eq.<uuid>)` — colunas do próprio usuário OU tasks atribuídas a ele. O board do Ops **não filtra por usuário**, então um cargo de gestão (DONO/gerente) vê o TODO da equipe inteira agregado. Para cargos não-gestão a diferença não aparece (já veem só o seu nos dois apps).

**✅ RESOLVIDO (v1.3.6):** a Notas ganhou o **modo "Todos"** (ver [§6.13](#6-recursos--funcionalidades)) — visão de leitura que agrega a equipe inteira, espelhando o "Todos" do Ops. Agora o DONO/gestão alterna entre **"minha conta"** (só o seu) e **"Todos"** (a equipe). O "2 vs 24" deixou de ser uma diferença inexplicada: é a mesma escolha de escopo que o Ops já oferecia.

### 11.3. Furo de RLS na tabela `tasks` — ✅ FECHADO (jun/2026)

Havia a policy PERMISSIVE **`Enable all access for authenticated users`** (cmd=ALL, `qual: auth.role() = 'authenticated'`) que deixava **qualquer usuário logado ler/editar/APAGAR TODAS as tasks** via API, anulando (por OR) as policies `*_for_hierarchy`.

**Correção aplicada no banco compartilhado:** a policy aberta foi **removida** e substituída por policies escopadas — `tasks_select_notas_scoped` (minhas colunas `status ~ '^USR_<id>_'` + categoria/nota compartilhada via helpers `notas_category_shared_with_me` e o novo `notas_task_note_shared_with_me`) e `tasks_update_notas_shared` (destinatário com EDIT; `status` protegido pelo WITH CHECK). Com a hierarquia (`Enable read/update/delete for hierarchy`), o resultado: **gestão lê tudo; demais só o seu + compartilhado**. Testado em transação: não-gestor passou a ver só o escopo dele (54 de 193), DONO vê tudo (193). **Looseness restante:** o INSERT (`Enable insert for authenticated`) ainda é aberto — qualquer logado insere task (baixo risco; pendência menor).

### 11.4. Bugs de dados legados (derivação antiga de status) — ✅ MIGRADO (jun/2026)

Havia ~38 tasks com `status` que não casava com nenhuma coluna (`custom_statuses`):

- **19** do Thales em sufixo `_IA` (deveria `_CRM_MILETO_IA`);
- **11** (luiz/Gabriel/Cauã) em `_PROGRESS` (deveria `_IN_PROGRESS`);
- **4** (Cauã/luiz) em `_REVIEW` (deveria `_IN_REVIEW`);
- **1** em `_CANCELLED`, **1** em `_PAGO`;
- **1** task do Arthur com key **MALFORMADA com hífens** (`USR_8500525e-9562-4a48-ba83-aae8fd25e741_TODO`).

O helper canônico `status-keys.ts` (v1.3.5) impede **novos** erros. Os **antigos foram migrados via psql (jun/2026):** 36 tasks movidas pras keys canônicas (`_IA`→`_CRM_MILETO_IA`, `_PROGRESS`→`_IN_PROGRESS`, `_REVIEW`→`_IN_REVIEW`, key com hífens→limpa) com trava de segurança (só move pra coluna existente); e as 3 órfãs sem coluna ganharam a coluna criada em `custom_statuses` (luiz "Em Revisão", Thales "Cancelado", Gabriel "Pago"). **Resultado: 0 tasks órfãs** — toda tarefa tem coluna válida nos dois apps.

---

## 12. Build, empacotamento e release

### Scripts npm

| Script | Comando | O que faz |
|---|---|---|
| `dev` | `cross-env ELECTRON_RUN_AS_NODE= vite` | Vite + Electron em dev (limpa `ELECTRON_RUN_AS_NODE` para o Electron rodar como GUI) |
| `build` | `tsc && vite build` | Type-check + build de renderer e processos Electron |
| `dist` | `npm run build && electron-builder` | Build + empacotamento/instalador |
| `preview` | `vite preview` | Preview do build |

`vite.config.ts`: `vite-plugin-electron` compila `electron/main.ts` e `electron/preload.ts` para `dist-electron/` (`sourcemap: true`, `external: ['electron','electron-store']`); o `onstart` do main limpa `ELECTRON_RUN_AS_NODE`; o renderer é buildado em `dist/`. Alias `@` → `./src`.

### electron-builder (`electron-builder.json5`)

| Chave | Valor |
|---|---|
| `appId` | `com.mileto.ops-notas` |
| `productName` | `Ops Notas` |
| `directories.output` | `release/${version}` |
| `directories.buildResources` | `build` |
| `artifactName` | `Ops-Notas-Setup.${ext}` |
| `files` | `dist/**/*`, `dist-electron/**/*` |
| `win.target` | `nsis` (x64), `win.icon` = `build/icon.ico` |

NSIS: `oneClick: false`, `allowToChangeInstallationDirectory: true`, atalhos desktop/menu iniciar (`shortcutName: "Ops Notas"`).

Publicação / GitHub Releases (`publish`): `provider: github`, `owner: impactorelampago-alt`, `repo: mileto-notas`, `releaseType: release`. O `electron-updater` lê dali o `.exe` + `latest.yml`; em runtime, `checkForUpdates()` baixa o `latest.yml`, compara com `1.3.5` e dispara `update-available` se houver versão maior.

### Fluxo de release

1. Bump da `version` no `package.json`.
2. `npm run dist`.
3. Criar GitHub Release com tag `vX.Y.Z`.
4. Upload do `latest.yml` + `.exe`.
5. Publish.

---

## 13. Limitações e pendências conhecidas

1. **Escopo Notas vs board do Ops** (§11.2): ✅ **resolvido (v1.3.6)** — a Notas ganhou o modo "Todos" (gestão alterna entre "minha conta" e "toda a equipe"), espelhando o Ops. O "2 vs 24" é a escolha de escopo, não bug.
2. **Furo de RLS em `tasks`** (§11.3): ✅ **fechado (jun/2026)** — policy aberta removida e substituída por escopadas + hierarquia (gestão lê tudo; demais só o seu/compartilhado). Resta só o INSERT aberto (pendência menor).
3. **Bugs de dados legados** (§11.4): ✅ **migrado (jun/2026)** — 36 tasks movidas pras keys canônicas + 3 colunas criadas → **0 órfãs**.
4. **Caveat das notificações `note_created`**: dispara no INSERT da task, antes do auto-título → o título vem como "Nova nota"/"Sem título" (clicar abre a nota com o título real); aponta por `task_id` (note_id NULL) e abrir depende da nota já estar carregada localmente.
5. **`get_ops_snapshot` é código morto no front**: o refresh usa 2 queries REST diretas; a RPC ainda existe na migration com derivação frágil por `split_part`.
6. **Modais órfãos**: `ConnectModal`, `CollaboratorsModal`, `SharedNotesModal`, `AssignCategoryModal` estão montados mas sem gatilho de abertura. `MenuBar` e `InputModal` existem mas não são montados.
7. **`SearchBar`** está visualmente pronto mas sem lógica de busca/substituição ligada (a busca funcional é o QuickSearch).
8. **Atalhos Ctrl+N / Ctrl+S / Ctrl+A sem emissor** (sem menu nativo/globalShortcut); o Editor está preparado mas nada os dispara.
9. **Tipo `Client` (types.ts) divergente do banco**: o código real usa `clients.company`/`notes`/`assigned_to_id`/`created_by_id`; o tipo declara `name`/`situation_*`/`assigned_to`. Usar o código como verdade.
10. **`createSection` calcula `position` pelo índice do array** (não pela coluna `position` do banco) — pode gerar colisões de posição.
11. **`closeAllTabs`** (notes-store) e **`hasLoaded`** (notifications-store) são órfãos (definidos, não usados).
12. **Compartilhamento não reflete no Ops** (por design): decidir futuramente se unifica com a delegação do Ops.

### Melhorias futuras (registradas no CLAUDE.md)

- **Login com Google (OAuth)**: habilitar provider no GoTrue + botão "Entrar com Google" + tratar callback no Electron.
- **Convite por email**: SMTP no GoTrue + fluxo de convite com `role` definido por quem convida.
- **Hierarquia de cargos (gerente→subordinados)**: falta o schema da tabela de cargos do Ops; quando existir, criar `notas_pode_supervisionar(target)` + policy de SELECT em `notes`.

---

## 14. Mapa de arquivos

```
ops-notas/
├── electron/
│   ├── main.ts                # Main: janela frameless, IPC (window:*/session:*/update:*),
│   │                          #   electron-store, electron-updater, guard de close (7s), doInstall
│   └── preload.ts             # Ponte window.electronAPI (window, sessionStorage, onBeforeClose,
│                              #   closeApp, updates) — removeAllListeners antes de cada on*
├── src/
│   ├── App.tsx                # Router (login vs app) + registro do salvar-ao-fechar
│   ├── main.tsx               # Entry React (#root, StrictMode)
│   ├── globals.css            # Tema "W11 Notepad Dark" (CSS vars), fontes, scrollbars, animações
│   ├── electron.d.ts          # Tipos da ponte (Window.electronAPI)
│   ├── vite-env.d.ts          # Tipos de import.meta.env
│   ├── pages/
│   │   ├── Login.tsx          # Login email/senha + Particles
│   │   └── MainApp.tsx        # Layout principal + montagem dos modais + efeitos de init
│   ├── components/
│   │   ├── UpdateBanner.tsx   # Banner de auto-update (máquina de estados)
│   │   ├── layout/
│   │   │   ├── Titlebar.tsx        # Barra superior custom (40px)
│   │   │   ├── TabBar.tsx          # Abas das notas (concluir/excluir/prioridade/context menu)
│   │   │   ├── CategorySelect.tsx  # Dropdown de categorias = sections (criar/editar/compartilhar)
│   │   │   ├── AccountSwitcher.tsx # Impersonação (trocar de conta)
│   │   │   ├── NotificationBell.tsx# Sino (task_completed / note_created)
│   │   │   ├── StatusBar.tsx       # Rodapé (Ln/Col, chars, salvamento)
│   │   │   └── MenuBar.tsx         # (NÃO montado) accordion de categorias + Sair
│   │   ├── editor/
│   │   │   ├── Editor.tsx          # Textarea, autossave, auto-título, colar imagem
│   │   │   ├── NoteMediaStrip.tsx  # Mídias (upload/colar/copiar/lightbox/signed URLs)
│   │   │   └── SearchBar.tsx       # (UI pronta, lógica não ligada)
│   │   └── ui/
│   │       ├── QuickSearch.tsx     # Busca rápida (Ctrl+K) — busca funcional
│   │       ├── SharePickerModal.tsx# Compartilhar categoria/nota (único caminho ativo)
│   │       ├── CategoryModal.tsx   # Criar/editar categoria
│   │       ├── DeleteNoteModal.tsx # Confirmar exclusão de nota
│   │       ├── DeleteSectionModal.tsx # Excluir section (avisa cascata)
│   │       ├── ClientAnnotationsModal.tsx     # Anotações de empresa (leitura)
│   │       ├── AddAnnotationToCompanyModal.tsx# Salvar trecho na empresa (append)
│   │       ├── ConnectModal.tsx    # (órfão) conectar nota a empresa/tarefa
│   │       ├── CollaboratorsModal.tsx # (órfão) note_collaborators
│   │       ├── SharedNotesModal.tsx# (órfão) compartilhadas comigo (note_collaborators)
│   │       ├── AssignCategoryModal.tsx # (órfão) atribuir category_id local
│   │       ├── InputModal.tsx      # (NÃO montado) entrada genérica
│   │       └── Particles.tsx       # Canvas do fundo do Login (50 partículas)
│   ├── stores/
│   │   ├── auth-store.ts           # Sessão + perfil + impersonação (raiz; getEffectiveUserId)
│   │   ├── notes-store.ts          # Notas, abas, sync nota↔task, concluir/reabrir, Realtime
│   │   ├── ops-store.ts            # Snapshot sections/tasks (2 queries REST), Realtime, reconciliação
│   │   ├── sharing-store.ts        # note_shares/category_shares (+ fallback local)
│   │   ├── notifications-store.ts  # Sino (notas_notifications)
│   │   ├── categories-store.ts     # note_categories (tabela própria, tangencial)
│   │   ├── collaborators-store.ts  # note_collaborators (fluxo legado)
│   │   ├── media-store.ts          # note_media + Storage + signed URLs
│   │   └── ui-store.ts             # Estado de UI/modais (sem rede)
│   └── lib/
│       ├── supabase.ts             # Cliente Supabase + electronStorage de sessão
│       ├── types.ts                # Tipos (Note, Task, Profile, Client*, etc.)
│       ├── status-keys.ts          # Identidade canônica de status (idêntico ao Ops)
│       ├── sections.ts             # Helpers de section (Lembrete, doneKeyForStatus, ...)
│       ├── note-priority.ts        # Ordem/labels/cores/normalização de prioridade
│       ├── local-drafts.ts         # Rascunhos + sessão (electron-store)
│       ├── completed-origins.ts    # Origens de conclusão (localStorage)
│       └── clipboard-image.ts      # Cópia de imagem (PNG via canvas)
├── supabase/migrations/
│   ├── redesign_notes_system.sql              # category_id UUID→TEXT; note_categories não usada
│   ├── add_note_priority_and_client_annotations.sql # notes.priority + note_client_annotations
│   ├── get_ops_snapshot.sql                   # RPC get_ops_snapshot (NÃO usada pelo front)
│   ├── rls_sharing_and_impersonation.sql      # Pacote 1: note_shares/category_shares + helpers + RLS
│   ├── rls_shared_edit_and_conclude.sql       # Pacote 2: edição por destinatário + notas_complete_task
│   ├── notas_notifications.sql                # Sino + trigger complete + notas_reopen_task
│   ├── note_media_and_shared_note_notify.sql  # note_media + bucket + trigger note_created
│   └── realtime_shares.sql                    # publication realtime de category_shares/note_shares
├── CLAUDE.md                  # Documento-mestre do projeto (integração com o Ops)
├── package.json               # v1.3.5
├── vite.config.ts
├── electron-builder.json5
├── tsconfig.json · tsconfig.node.json · postcss.config.js
└── DOCUMENTACAO-MILETO-NOTAS.md  # (este documento)
```

*\* O tipo `Client` em `types.ts` está desatualizado em relação às colunas reais usadas no código (`company` etc.) — ver §4.5 e §13.*
