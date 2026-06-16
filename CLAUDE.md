# CLAUDE.md — Mileto Notas (Ops Notas)

> ⚠️ **PRINCÍPIO FUNDAMENTAL E INVIOLÁVEL — LEIA SEMPRE PRIMEIRO**
>
> O **Mileto Notas é uma EXTENSÃO do Mileto Ops**. Os dois **compartilham o MESMO banco** (Supabase self-hosted em `supabase.miletoops.com`). Portanto: **TODA e QUALQUER atualização no Notas DEVE ser pensada e refletida para andar em SINCRONIA com o Mileto Ops.** Antes de qualquer mudança (schema, RLS, categorias = `custom_statuses`, tarefas = `tasks`, status, prioridade, compartilhamento), **avalie o impacto no Ops** e mantenha os dois alinhados. Sempre que uma mudança tocar o banco/integração, **gere também uma "copy" pra aplicar no Mileto Ops** (texto pronto pra colar no Claude do Ops).
>
> 📌 **Este é o ÚNICO MD do programa.** Regras, integração com o Ops e melhorias futuras vivem TODAS aqui — não criar outros `.md` soltos.

## 🧠 IDENTIDADE
Você é um dev senior especialista em Electron, React, TypeScript e apps desktop. Você trabalha no **Mileto Notas** — um app desktop de bloco de notas colaborativo integrado com o Mileto Ops.

Seu papel: Executar com precisão cirúrgica. Nunca inventar, nunca assumir, nunca "melhorar" sem ser pedido.

## 🚨 REGRAS INVIOLÁVEIS

### Antes de QUALQUER alteração:
1. LEIA os arquivos envolvidos por completo
2. ENTENDA o que já existe e por quê
3. PERGUNTE se tiver qualquer dúvida — NÃO assuma
4. PROPONHA o que vai fazer antes de executar
5. EXECUTE somente após aprovação

### Nunca faça:
- Deletar código sem ser pedido
- Refatorar o que não foi solicitado
- Adicionar dependências sem perguntar
- Usar `any` no TypeScript
- Ignorar erros — reporte antes de "consertar"
- Mudar a estrutura de pastas estabelecida

### Sempre faça:
- Tipar tudo explicitamente
- Seguir o padrão visual estabelecido
- Manter código limpo e legível
- Componentes pequenos e focados
- Separar lógica de UI (stores vs components)

## 📁 ESTRUTURA DO PROJETO
ops-notas/
├── electron/
│   ├── main.ts              # Processo principal Electron
│   ├── preload.ts           # Bridge electron ↔ renderer
│   └── updater.ts           # Auto-update via GitHub Releases
├── src/
│   ├── components/
│   │   ├── layout/          # Titlebar, Sidebar, StatusBar
│   │   ├── editor/          # Editor de notas
│   │   ├── notes/           # Lista de notas, cards
│   │   └── ui/              # Componentes base (button, input, modal, etc)
│   ├── stores/              # Zustand stores
│   │   ├── auth-store.ts
│   │   ├── notes-store.ts
│   │   └── ui-store.ts
│   ├── lib/
│   │   ├── supabase.ts      # Cliente Supabase
│   │   └── types.ts         # Tipos TypeScript
│   ├── pages/
│   │   ├── Login.tsx         # Tela de login
│   │   └── App.tsx           # Tela principal (após login)
│   ├── App.tsx               # Router (login vs app)
│   ├── main.tsx              # Entry point React
│   └── globals.css           # Estilos globais
├── CLAUDE.md
├── package.json
├── tsconfig.json
├── tsconfig.node.json
├── vite.config.ts
├── postcss.config.js
├── tailwind.config.ts        # Se Tailwind v3, senão postcss direto
├── electron-builder.json5    # Config de build e auto-update
└── .gitignore

## 🔧 STACK

| Camada | Tecnologia |
|--------|-----------|
| Desktop | Electron 30+ |
| Bundler | Vite 5 |
| UI | React 18 + TypeScript |
| Estilo | Tailwind CSS v4 |
| State | Zustand 5 |
| Banco | Supabase (PostgreSQL + Auth + Realtime) |
| Auto-update | electron-updater + GitHub Releases |
| Icons | Lucide React |
| Date | date-fns |
| Animations | Framer Motion |

## 🗄️ BANCO DE DADOS (Supabase)

URL: https://supabase.miletoops.com

### Tabelas:
- **notes** — id, title, content, category_id, client_id, task_id, creator_id, is_pinned, is_archived, created_at, updated_at
- **note_categories** — id, name, color, icon, user_id, position, created_at, updated_at
- **note_collaborators** — id, note_id, user_id, permission (VIEW/EDIT), added_by, created_at

### Tabelas do Mileto Ops (somente leitura — para vincular notas):
- **clients** — empresas/clientes da agência
- **tasks** — tarefas da agência
- **profiles** — usuários do sistema

### RLS:
- Criador tem acesso total à nota
- Colaborador VIEW pode apenas ler
- Colaborador EDIT pode ler e atualizar
- Somente o criador pode deletar notas
- Categorias são isoladas por usuário

## 🎨 PADRÃO VISUAL

- **Referência:** Windows 11 Notepad (minimalista, limpo, profissional)
- **Tema:** Dark mode como padrão (com possibilidade de light mode futuro)
- **Cores base:** fundo zinc-900/950, bordas zinc-700/800, texto zinc-100/300
- **Accent:** emerald-500 (#10B981) — mesma cor padrão das categorias
- **Titlebar:** Custom titlebar (frameless window) com botões de fechar/minimizar/maximizar
- **Layout:** Sidebar esquerda (categorias + lista de notas) + Editor direita
- **Fonte do editor:** JetBrains Mono ou sistema monospace
- **Animações:** Sutis com Framer Motion (transições de 150-200ms)

## 🚀 BUILD E DEPLOY

- Build: `npm run dist` (vite build + electron-builder)
- Auto-update: electron-updater com GitHub Releases
- Fluxo de release:
  1. Bump version no package.json
  2. `npm run dist`
  3. Criar GitHub Release com tag `vX.Y.Z`
  4. Upload `latest.yml` + `.exe`
  5. Publish

## 💬 COMUNICAÇÃO
- Responda SEMPRE em português brasileiro
- Seja direto e técnico
- Se não souber algo, diga "não sei"
- Se encontrar um bug, reporte mas NÃO corrija sem pedir

## 🔗 INTEGRAÇÃO COM O MILETO OPS (banco compartilhado)
- **Notas ↔ Ops:** cada nota é 1:1 com uma `task` (`notes.task_id`). `notes.content`↔`tasks.description`, `notes.title`↔`tasks.title`, `notes.priority`↔`tasks.priority`. A "categoria" do Notas **é a section do Ops** = `custom_statuses` (vínculo via `tasks.status` = `custom_statuses.key`, key = `USR_<idSemHifens>_<SUFIXO>`).
- **Criar categoria/nota no Notas reflete no Ops** (mesmas tabelas `custom_statuses`/`tasks`). **Compartilhamento NÃO reflete no Ops** (vive em tabelas só do Notas — ver abaixo).
- **Objetos criados pelo Notas no banco compartilhado (já aplicados, jun/2026):** tabelas `note_shares`, `category_shares`; funções `notas_is_dono`, `notas_can_share_note`, `notas_owns_category_key`, `notas_category_shared_with_me`, `notas_current_role`; policies aditivas de SELECT em `notes` (`notes_select_dono_reads_all`, `notes_select_shared_with_me`, `notes_select_shared_category`). Trava de segurança: `profiles` (UPDATE) ganhou `WITH CHECK` que impede o usuário trocar o próprio `role` (auto-promoção a DONO). `profiles.role` é enum `user_role`.
- **Impersonação:** DONO pode "entrar" na conta de qualquer um (`auth-store.getEffectiveUserId`/`viewingAs`); leitura liberada pela policy `notes_select_dono_reads_all`.
- **Bugs de integridade compartilhada (pré-existentes, corrigir nos dois apps):** derivação da `key` diverge (`createSection` trunca em 60; `createTaskInOps` não) → para labels longos `custom_statuses.key` ≠ `tasks.status`; e a extração de sufixo pelo último `_` quebra com `_` interno (`EM_ESPERA_2`). Usar a key COMPLETA como identidade.
- **Regra:** ao mexer em qualquer um desses, gerar a copy pro Claude do Ops e manter sincronia.

### 📋 A PASSAR PRO OPS (registro acumulado — copiar daqui ao sincronizar o Ops)
> Mantido vivo: toda mudança que toca o banco/integração entra aqui.
1. **Trava de `role`:** `profiles` UPDATE agora bloqueia o usuário trocar o próprio `role` (anti auto-promoção a DONO). Atribuição de cargo deve ser via `service_role`/admin.
2. **Objetos novos no banco compartilhado:** tabelas `note_shares` (permission VIEW/EDIT), `category_shares`; funções `notas_*`; RPC `notas_complete_task`; policies aditivas em `notes` (SELECT: dono-lê-tudo/shared_with/shared_category; UPDATE: `notes_update_shared_editor`). Originais do Ops intactas. Não recriar com esses nomes.
3. **Concluir (no Notas) = mover `tasks.status` pro DONE do dono** → reflete no kanban do Ops (mesma tabela `tasks`, via Realtime). **No Ops a tarefa muda pra coluna Concluído** (continua existindo). **No Notas ela NÃO sai da categoria** — fica marcada com ✓ verde (título riscado) e o ✓ é um **toggle** (concluir/reabrir). A "categoria de origem" que mantém a nota visível é **local do Notas** (localStorage `notas:completed-origins`, key = `task_id`), **não vai pro banco** — o estado "concluída" de verdade é a `tasks.status`. **Reabrir (desfazer) = RPC nova `notas_reopen_task(p_task_id, p_target_status)`** (SECURITY DEFINER; valida que o destino é do mesmo dono + acesso por category_shares/note_shares EDIT; default = TODO do dono). Substituiu o PATCH direto, que afetava 0 linhas pro colaborador (RLS) e fingia sucesso. **"DONE" é identidade ESTRITA** `USR_<id32>_DONE` (prefixo 37 + 'DONE') em todo lugar (`isDoneStatus`, trigger, RPC) — sufixos custom terminados em DONE (ex.: NOT_DONE) NÃO contam.
4. **Compartilhar categoria/nota é só do Notas** (`note_shares`/`category_shares`); destinatário com EDIT edita o conteúdo (atualiza `tasks.description`), nunca apaga/move. Decidir se unifica com a delegação do Ops.
5. **Identidade de status — ✅ RESOLVIDO nos 2 apps (jun/2026, v1.3.5).** Era: derivação da `key` divergia (createSection truncava em 60; extração de sufixo por `split('_').pop()` quebrava com `_` interno tipo EM_ESPERA_2/IN_PROGRESS) → notas/tarefas caíam na categoria errada. Agora ambos usam o **helper canônico idêntico** (`src/lib/status-keys.ts` no Notas): key = `USR_<32hex>_<SUFIXO>` (prefixo 37); `getStatusBase` (regex, sufixo completo), `isStatusSuffix`, `isDoneStatus`, `buildStatusKey` (sem truncar). Se mexer na regra, manter os dois byte-a-byte.
6. **Cores de prioridade** (se o Ops usar outras): Urgente `#ef4444`, Alta `#f97316`, Média `#eab308`, Baixa `#a5b4fc`.
7. **Sino de notificações do Notas (NOVO — independente do sino do Ops):** objeto SÓ do Notas. Tabela `notas_notifications` (RLS: destinatário lê/marca lida; sem INSERT pra `authenticated`; na publication `supabase_realtime`). **Dois tipos:** (a) `task_completed` — trigger `trg_notas_notify_on_complete` AFTER UPDATE OF status em `tasks` (status vira `_DONE` e `auth.uid() <> creator_id`); (b) `note_created` — trigger `trg_notas_notify_on_shared_note` AFTER INSERT em `tasks` (status = `category_shares.category_key` → avisa cada `shared_with`, exceto criador/ator). Ambos `SECURITY DEFINER` + insert best-effort/EXCEPTION pra **nunca** abortar a escrita na task. **NÃO mexer/mesclar com o sino do Ops.** Arquivos: `supabase/migrations/notas_notifications.sql` (+ trigger note_created em `note_media_and_shared_note_notify.sql`). **Status: ✅ APLICADO na VPS (jun/2026).**
8. **Mídias por nota (NOVO):** tabela `note_media` (note_id→notes, storage_path, mime_type, filename, created_by; RLS: SELECT reaproveita a visibilidade de `notes` via `EXISTS(notes)`; INSERT = `notas_can_edit_note(note_id)`; DELETE = quem subiu ou dono da nota) + **bucket de Storage privado `note-media`** (25MB, **só raster: png/jpeg/gif/webp/avif — SVG fora** de propósito) com policies em `storage.objects` espelhando o acesso à nota (pasta = `<note_id>/...`; leitura = nota visível; upload/remoção = `notas_can_edit_note`). Front exibe via **signed URLs** (renovadas a cada 90min e na hora de copiar). Arquivo: `supabase/migrations/note_media_and_shared_note_notify.sql`. **Status: ✅ APLICADO na VPS (jun/2026).** (Ops: se for usar mídias no kanban, mesma tabela/bucket.)
9. **Caveats conhecidos (baixo, por design):** (a) a notificação `note_created` dispara no INSERT da task (antes do auto-título), então o título costuma vir como "Nova nota"/"Sem título" — clicar abre a nota com o título real; (b) ela aponta por `task_id` (note_id NULL) e abrir depende da nota já estar carregada localmente. Se incomodar, mover o disparo pro INSERT de `notes` (tem note_id e título já definido).
10. **Notas não carregavam (visibilidade) — ✅ RESOLVIDO no banco (jun/2026, v1.3.9):** duas falhas distintas. (a) Tarefa na MINHA coluna com a NOTA criada por outra pessoa (ex.: o dono) não aparecia no Notas — a RLS de `notes` era por `creator_id`/núcleo e bloqueava ler nota de terceiro, mesmo na coluna do usuário. (b) Categoria COMPARTILHADA (`category_shares`) não aparecia nem pro destinatário REAL (não era só impersonação) — ele lia o `category_shares` e a `note`, mas NÃO a `custom_status` nem as `tasks` daquela categoria (tabelas do Ops), então o snapshot nunca montava a seção. **3 policies SELECT aditivas (PERMISSIVE, OR-combinadas — não removem nada existente):**
    - `notes` (tabela do Notas): `notes_select_linked_task` — `USING (task_id is not null AND EXISTS(SELECT 1 FROM tasks t WHERE t.id = notes.task_id))`. A nota fica tão visível quanto a task vinculada (a subquery respeita a RLS de tasks). Conserta (a).
    - `tasks` (tabela do OPS): `notas_tasks_select_shared_category` — `USING (notas_category_shared_with_me(id))` (reusa o helper SECDEF). Destinatário de categoria compartilhada lê as tasks dela. **NÃO vira coluna no board do Ops** (o board filtra `status like USR_<eu>_*`), só torna legível. Conserta (b).
    - `custom_statuses` (tabela do OPS): `notas_cs_select_shared_category` — `USING (EXISTS(SELECT 1 FROM category_shares cs WHERE cs.category_key = custom_statuses.key AND cs.shared_with = auth.uid()))`. Destinatário lê a row da categoria compartilhada (cabeçalho da seção). Conserta (b).
    **Front (só Notas):** `notes-store.loadNotesForVisibleTasks()` carrega a nota de TODA task visível (`ops-store.tasks`) ainda não na tela — qualquer criador; chamado no fim do `refreshOpsSnapshot` (depois das tasks já estarem no store). No-op quando nada falta (custo zero no polling). **Verificado por simulação de RLS (Gabriel `4c802f20…`):** coluna própria "Em Progresso" 4/4 notas (era 1/4); CRM compartilhada cs=1/tasks=1/nota=1 (era 0/0/—). **Status: ✅ APLICADO na VPS (jun/2026).** Se o Ops quiser exibir categorias compartilhadas na própria UI, a leitura já está liberada por essas policies.
11. **"Lembrete" duplicado no seletor (DONO) — ✅ RESOLVIDO (jun/2026, v1.3.9):** o DONO lê as colunas TODO de TODOS (policy de dono pré-existente em `custom_statuses`). O rename "A Fazer"→"Lembrete" tinha pulado 1 usuário (`USR_f288a872…_TODO` ficou "A Fazer"). Como o Notas **exibe todo TODO como "Lembrete"** (`sectionDisplayLabel`) mas o snapshot **deduplicava por label salvo**, "A Fazer" + "Lembrete" viravam **duas** seções "Lembrete". **Dois consertos:** (a) **dado** — `UPDATE custom_statuses SET label='Lembrete'` no row que faltava (completa o rename; toca tabela do Ops, mas idêntico ao já feito nos outros 10 — o Ops não precisa fazer nada, só fica ciente); (b) **front (só Notas)** — `refreshOpsSnapshot` passou a deduplicar as seções de SISTEMA **por sufixo** (não por label) e a usar **a key do PRÓPRIO usuário logado** (corrige a duplicata + garante que tarefa nova caia na coluna certa do usuário, mesmo com label divergente entre usuários). **NÃO é causado nem resolvido pelas policies do item 10** (aquelas são SELECT de visibilidade; isso é label/dedup).
12. **Impersonação completa + edição por permissão (jun/2026, v1.4.0):** a impersonação (ver a conta de outro pelo seletor) é LEITURA por natureza — a RLS amarra criação ao usuário logado, então (a) tarefa criada direto no Ops (sem nota) não aparecia na conta visualizada, e (b) editar depende do `notes_update_nucleo` (cargo_edit/DONO). **Resolvido:**
    - **Back (só Notas):** novo RPC `notas_create_missing_notes_for(p_owner uuid)` `SECURITY DEFINER` — cria as notas que faltam de `p_owner` (`creator = p_owner`) SE o chamador pode VER p_owner (próprio/DONO/`notas_visible_creator_ids`). Cria `notes` (tabela só da Notas) — **sem impacto no Ops**. Arquivo: `supabase/migrations/notas_impersonation_orphan_notes.sql`. **Status: ✅ APLICADO na VPS.** (VER/EDITAR e as RLS `notes_select_nucleo`/`notes_update_nucleo` já existiam — `notas_nucleo_visibility.sql`.)
    - **Front (só Notas):** `auth-store.loadPermissionSets()` carrega `visibleIds`/`editableIds` (RPCs `notas_visible/editable_creator_ids`); `ensureNotesForOrphanTasks` em impersonação chama o RPC pro usuário visualizado (em vez de pular); o **editor entra somente-leitura** quando você só pode VER o criador da nota (libera se DONO / compartilhada-EDIT / `cargo_edit`); o **seletor de contas** mostra badge VER (olho) / EDITAR (caneta) por pessoa. Regra idêntica às Permissões da Equipe do Ops: DONO vê+edita todos; cada cargo conforme `cargo_visibility`/`cargo_edit`.
13. **Escrita em impersonação + exclusão por permissão + anti-apagamento (jun/2026, v1.4.1):** criar nota impersonando criava na conta de QUEM ESTAVA LOGADO (sumia na do visualizado) e título/texto se perdiam; apagar nota de terceiro era bloqueado; e o conteúdo sumia na **categoria compartilhada**. **Back (só Notas — 2 RPCs SECURITY DEFINER, validam que o chamador pode EDITAR o alvo: próprio/DONO/`notas_editable_creator_ids`):** `notas_create_note_for(p_owner, p_status, p_title, p_content)` cria tarefa+nota COMO o visualizado (creator=ele); `notas_delete_note_for(p_note_id)` apaga nota+tarefa de quem você pode editar. Arquivo: `supabase/migrations/notas_impersonation_write.sql`. **Status: ✅ APLICADO na VPS** (criação verificada: DONO cria pro Gabriel com título+texto persistindo). **Front (só Notas):** `createNote` em impersonação usa o RPC; `deleteNote` de nota de terceiro usa o RPC; `canDeleteNote` libera DONO+cargo_edit; e **proteção anti-apagamento** no `syncNotesFromTaskDescriptions` — `tasks.description` VAZIA nunca apaga conteúdo de nota com texto (o clock-skew fazia "task mais novo" dar sempre true e apagar o texto recém-digitado, sobretudo em categoria compartilhada).

## 🛠️ MELHORIAS FUTURAS
1. **Login com Google (OAuth):** credenciais no Google Cloud (Client ID/Secret, redirect `https://supabase.miletoops.com/auth/v1/callback`) → habilitar provider no GoTrue (`ic-supabase-auth`, env `GOTRUE_EXTERNAL_GOOGLE_*`) → botão "Entrar com Google" no [src/pages/Login.tsx] (`signInWithOAuth`, tratar callback no Electron). Definir `role` inicial de quem entra pela 1ª vez.
2. **Convite por email:** SMTP no GoTrue (`GOTRUE_SMTP_*`) → fluxo de convite (tabela `invites` ou `inviteUserByEmail` via Edge Function/service_role) com `role` definido por quem convida (respeitando hierarquia) → front de convidar + aceitar. Casa com a hierarquia de cargos pendente e com `note_shares`/`category_shares`.
3. **Hierarquia de cargos (gerente→subordinados):** falta o schema da tabela de cargos do Ops; quando existir, criar `notas_pode_supervisionar(target)` + policy de SELECT em `notes`.
