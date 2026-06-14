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
5. **Bugs de integridade compartilhada (corrigir nos 2 apps):** derivação da `key` diverge (createSection trunca em 60; createTask não); extração de sufixo pelo último `_` quebra com `_` interno → usar a **key COMPLETA** como identidade.
6. **Cores de prioridade** (se o Ops usar outras): Urgente `#ef4444`, Alta `#f97316`, Média `#eab308`, Baixa `#a5b4fc`.
7. **Sino de notificações do Notas (NOVO — independente do sino do Ops):** objeto SÓ do Notas. Tabela `notas_notifications` (RLS: destinatário lê/marca lida; sem INSERT pra `authenticated`; na publication `supabase_realtime`). **Dois tipos:** (a) `task_completed` — trigger `trg_notas_notify_on_complete` AFTER UPDATE OF status em `tasks` (status vira `_DONE` e `auth.uid() <> creator_id`); (b) `note_created` — trigger `trg_notas_notify_on_shared_note` AFTER INSERT em `tasks` (status = `category_shares.category_key` → avisa cada `shared_with`, exceto criador/ator). Ambos `SECURITY DEFINER` + insert best-effort/EXCEPTION pra **nunca** abortar a escrita na task. **NÃO mexer/mesclar com o sino do Ops.** Arquivos: `supabase/migrations/notas_notifications.sql` (+ trigger note_created em `note_media_and_shared_note_notify.sql`). **Status: ✅ APLICADO na VPS (jun/2026).**
8. **Mídias por nota (NOVO):** tabela `note_media` (note_id→notes, storage_path, mime_type, filename, created_by; RLS: SELECT reaproveita a visibilidade de `notes` via `EXISTS(notes)`; INSERT = `notas_can_edit_note(note_id)`; DELETE = quem subiu ou dono da nota) + **bucket de Storage privado `note-media`** (25MB, **só raster: png/jpeg/gif/webp/avif — SVG fora** de propósito) com policies em `storage.objects` espelhando o acesso à nota (pasta = `<note_id>/...`; leitura = nota visível; upload/remoção = `notas_can_edit_note`). Front exibe via **signed URLs** (renovadas a cada 90min e na hora de copiar). Arquivo: `supabase/migrations/note_media_and_shared_note_notify.sql`. **Status: ✅ APLICADO na VPS (jun/2026).** (Ops: se for usar mídias no kanban, mesma tabela/bucket.)
9. **Caveats conhecidos (baixo, por design):** (a) a notificação `note_created` dispara no INSERT da task (antes do auto-título), então o título costuma vir como "Nova nota"/"Sem título" — clicar abre a nota com o título real; (b) ela aponta por `task_id` (note_id NULL) e abrir depende da nota já estar carregada localmente. Se incomodar, mover o disparo pro INSERT de `notes` (tem note_id e título já definido).

## 🛠️ MELHORIAS FUTURAS
1. **Login com Google (OAuth):** credenciais no Google Cloud (Client ID/Secret, redirect `https://supabase.miletoops.com/auth/v1/callback`) → habilitar provider no GoTrue (`ic-supabase-auth`, env `GOTRUE_EXTERNAL_GOOGLE_*`) → botão "Entrar com Google" no [src/pages/Login.tsx] (`signInWithOAuth`, tratar callback no Electron). Definir `role` inicial de quem entra pela 1ª vez.
2. **Convite por email:** SMTP no GoTrue (`GOTRUE_SMTP_*`) → fluxo de convite (tabela `invites` ou `inviteUserByEmail` via Edge Function/service_role) com `role` definido por quem convida (respeitando hierarquia) → front de convidar + aceitar. Casa com a hierarquia de cargos pendente e com `note_shares`/`category_shares`.
3. **Hierarquia de cargos (gerente→subordinados):** falta o schema da tabela de cargos do Ops; quando existir, criar `notas_pode_supervisionar(target)` + policy de SELECT em `notes`.
