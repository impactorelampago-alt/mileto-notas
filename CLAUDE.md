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
3. **Concluir (no Notas) = mover `tasks.status` pro DONE do dono** → reflete no kanban do Ops (mesma tabela `tasks`, via Realtime). **No Ops a tarefa muda pra coluna Concluído** (continua existindo). **No Notas (v1.4.8+) ela TAMBÉM passa pra categoria "Concluído"** — antes (≤v1.4.7) ficava na categoria de origem com ✓ verde; agora SAI da origem e aparece em Concluído (título riscado + ✓ verde = **toggle** concluir/reabrir). A "categoria de origem" (localStorage `notas:completed-origins`, key = `task_id`, **não vai pro banco**) agora serve **só pro reabrir voltar à coluna de onde saiu** — o estado "concluída" de verdade é a `tasks.status`. **Reabrir (desfazer) = RPC nova `notas_reopen_task(p_task_id, p_target_status)`** (SECURITY DEFINER; valida que o destino é do mesmo dono + acesso por category_shares/note_shares EDIT; default = TODO do dono). Substituiu o PATCH direto, que afetava 0 linhas pro colaborador (RLS) e fingia sucesso. **"DONE" é identidade ESTRITA** `USR_<id32>_DONE` (prefixo 37 + 'DONE') em todo lugar (`isDoneStatus`, trigger, RPC) — sufixos custom terminados em DONE (ex.: NOT_DONE) NÃO contam.
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
14. **Flags de compartilhamento invertidas + UPDATE tasks faltando + auto-título quebrado (jun/2026, v1.4.2) — 3 bugs raiz no compartilhamento:** (a) `!notImpersonating` em `notes-store.loadNotes` estava **invertido** — `is_shared_with_me`/`shared_permission` nunca eram setados fora de impersonação, tornando TODAS as notas de categoria compartilhada somente-leitura no Editor; corrigido para `notImpersonating`. (b) Sem policy UPDATE em `tasks` para editor de categoria compartilhada, a task ficava com `description` antiga → o sync sobrescrevia o texto digitado; corrigido com 2 policies PERMISSIVE em `tasks`. (c) `semTitulo` em `Editor.tsx` não incluía `'Nova nota'`/`'Sem titulo'` → auto-título não atualizava notas novas; corrigido. **Front:** só o Notas (notes-store.ts + Editor.tsx).
15. **AUDITORIA COMPLETA (jun/2026, v1.4.2) — 51 achados confirmados (0 crítico; 3 alto, 17 médio, 31 baixo/info), verificados por workflow adversarial.** Corrigidos nesta leva:
    - **Back (✅ APLICADO + VERIFICADO na VPS, jun/2026, via psql no ic-supabase-db):**
      - `notas_tasks_update_policies.sql`: inspeção do banco revelou que a policy real do Notas chama-se **`tasks_update_notas_shared`** (não os nomes que eu supus) e estava **frouxa** (USING/WITH CHECK = `notas_category_shared_with_me(id) OR notas_task_note_shared_with_me(id, true)`, sem travar coluna) → FURO: editor de categoria compartilhada movia task de coluna no board do Ops. As minhas policies da v1.4.2 (`ANY(setof)`) **nunca aplicaram** (erro de sintaxe — confirmado: não existiam no banco). `get_ops_snapshot` **não existe** no banco (falso alarme). **Conserto aplicado:** recriei `tasks_update_notas_shared` com a MESMA condição de acesso + WITH CHECK que CONGELA status/creator/assignee; criei `notas_tasks_update_nucleo_editor` (strict) p/ cargo_edit não-DONO/GERENTE. **Verificado:** `pg_policies` → ambas com `with_check like '%o.status%'` = `t`; a policy do Ops `Enable update for hierarchy` intacta.
      - `notas_audit_fixes_v142.sql` (aplicado como versão sem comentários, corpo idêntico): **(B)** `notas_can_complete_task` agora exige `permission='EDIT'` na via de note_shares (VIEW-only não conclui/move pro DONE no Ops). **(E)** `notas_reopen_task` ganhou autorização SIMÉTRICA ao concluir (DONO/assignee/cargo_edit + shares) — antes DONO concluía mas não reabria. **(D)** `notas_create_note_for` valida que `p_status` tem o prefixo de 37 chars do `p_owner` (não cria task na coluna de terceiro). Aplicado: `CREATE FUNCTION ×3 / GRANT / REVOKE / COMMIT` sem erro.
    - **Front (só Notas — aplicado):** (1) **persistência**: helper `tsNewer`/`tsMs` (compara `updated_at` por epoch via `Date.parse`, não string ISO — os formatos das 2 pontas divergiam e furavam a proteção anti-apagamento); gate de **rascunho pendente** (`_pendingDraftIds`) + tolerância de skew no `syncNotesFromTaskDescriptions` (description antiga não apaga texto digitado); **guard de geração de visão** (`_viewGeneration`/`bumpViewGeneration`) em loadNotes/loadNotesForVisibleTasks/refreshOpsSnapshot (troca de conta durante os awaits não grava dados da conta antiga); `deleteNote` apaga **nota antes da task** (órfã recuperável em vez de divergir do Ops). (2) **races**: `reconcileShares`/foco encadeiam loadNotes **depois** do refresh (anti-flicker); `_retryTimer` do realtime rastreado/limpo + só re-subscreve se autenticado. (3) **permissão**: helper único `auth-store.canEditNote`; Editor usa ele; TabBar **gateia o dot de prioridade e o renomear**; guarda `viewAll` em updateNote/completeNote/toggleComplete (store, não só UI); force-save/unmount do Editor checam `isReadOnly`; `deleteSection` usa a **key COMPLETA** da seção (não reconstrói pela minha) + bloqueia viewAll/compartilhada. (4) **sharing**: setNoteShare/setCategoryShare **retornam erro** (não fingem sucesso quando a RLS recusa) e o SharePickerModal mostra a falha; SharedNotesModal lê `note_shares` (não a tabela legada `note_collaborators`).
    - **NÃO corrigidos (decisão/risco — ⚠️ DECIDIR):** (i) **furo de visibilidade** `notes_select_linked_task` torna a nota tão visível quanto a task vinculada, anulando a restrição por núcleo de `notes_select_nucleo` (as 2 policies PERMISSIVE se contradizem) — apertar sem testar arrisca regredir o "notas não carregam"; é decisão de produto (por núcleo vs igual-à-task). (ii) **category_shares sem coluna `permission`**: toda categoria compartilhada é EDIT (não há VIEW-only); coluna opcional escrita em `notas_audit_fixes_v142.sql` (comentada), front só lê depois de aplicada. (iii) **`get_ops_snapshot`** órfão/inseguro (SECDEF sem search_path, bug de `split_part`) — o Notas não usa, mas o **Ops pode**; não dropar sem confirmar. (iv) modo "Todos": categorias custom de donos diferentes com mesmo sufixo colidem numa seção (cosmético; corrigir exigiria reescrever a identidade de seção, hoje baseada em `key_suffix`).

16. **Impersonação não via task de categoria compartilhada (jun/2026, v1.4.4) — só Notas, client-side:** o DONO impersonando um usuário NÃO via tarefas que estavam em categorias que ELE compartilhou com esse usuário (`category_shares`, status `USR_<dono>_<suf>`) — o usuário logado de verdade via. Causa: a impersonação é client-side (dono lê com o próprio JWT, app filtra por `getEffectiveUserId`) e 2 gates desligavam o ramo compartilhado: (1) `ops-store.refreshOpsSnapshot` `includeShared = notImpersonating && !viewAll` → false impersonando → pulava o fetch das tasks de categoria compartilhada (a query principal `status.like.USR_<eff>_* OR assignee=eff` não casa `USR_<dono>_*`); (2) `sharing-store.loadShares` só carregava `sharedWithMeCategories` `if(!isImpersonating)` e por `shared_with=<usuário REAL>`; (3) `auth-store.setViewingAs` não chamava `loadShares`. **Fix:** (1) `includeShared = !viewAll`; (2) loadShares usa `getEffectiveUserId()` e roda sempre (filtra `shared_with=effective`); (3) `setViewingAs`/`setViewAll` chamam `loadShares()` antes do snapshot. A RLS `category_shares_select (shared_by OR shared_with = auth.uid())` deixa o dono ler pq é o `shared_by`; a nota carrega via `notes_select_linked_task`. **NÃO toca banco/Ops.** Limitação: cobre categorias que o PRÓPRIO dono compartilhou (share de terceiro p/ o usuário não é legível pelo JWT do dono — precisaria policy "DONO lê todos `category_shares`").

17. **DONO controle total + DONO lê todos os `category_shares` (jun/2026, v1.4.5):** (a) **Back (aplicado na VPS):** policy aditiva `category_shares_dono_reads_all` (`FOR SELECT USING (notas_is_dono())`) — completa a impersonação do item 16: o DONO passa a ver categorias compartilhadas por QUALQUER um com o usuário visualizado (antes só as que ELE compartilhou). `category_shares` é tabela só do Notas → **não afeta o Ops**. Rollback: `DROP POLICY category_shares_dono_reads_all ON public.category_shares`. (b) **Front (só Notas):** o DONO não conseguia editar tarefas de outros (gates de `viewAll`/compartilhada-sem-EDIT no front), embora a RLS já permitisse (`notes_update_nucleo` → `notas_editable_creator_ids()` retorna TODOS pro DONO; `tasks` "Enable update for hierarchy" libera role DONO sem WITH CHECK). Novo helper `auth-store.isDono()` (role DONO do usuário REAL; impersonação não troca `profile`, só `viewingAs`); os gates de edição exemptam o DONO: `Editor.isReadOnly`, `notes-store.updateNote`/`flushPendingDrafts`, `NoteDetailBar.readOnly`. Agora o DONO edita conteúdo/título/prioridade/cliente/status de qualquer tarefa em qualquer modo (perfil/Todos/compartilhada). NÃO tocou `completeNote`/`toggleComplete` (RPC, "concluir") nem `deleteSection` (apagar em massa).

18. **Ícones + arrastar abas (ordem ↔ Ops) + texto vazio de task do Ops (jun/2026, v1.4.6) — só Notas:** (a) **Ícones:** SyncStatus simplificado (nuvem=sincronizado / 2 setas girando=atualizando / nuvem cortada=offline; removido o estado laranja "tempo real caiu"); UpdateButton com ícone `Download` limpo. (b) **Arrastar abas:** o Notas passa a ordenar as abas pela coluna `tasks.position` (a MESMA do board do Ops) + desempate por `created_at`; arrastar uma aba grava `position` 0,1,2,… na nova ordem (`ops-store.reorderTasksInSection` → `update tasks.position`, reflete no board do Ops); tarefa NOVA vai pro TOPO (`createTaskInOps` usa `position = min(position do status) - 1`). DnD nativo HTML5; gateado em `!viewAll`. (c) **Texto vazio de task do Ops:** `syncNotesFromTaskDescriptions` agora PERSISTE no banco (`notesPatch`) ao preencher uma nota vazia a partir da `description` da task — antes só na tela, e o `loadNotes` recarregava o vazio por cima ("some mesmo sincronizando"; era o caso da categoria "Salvos"). Backfill das 8 notas vazias acontece sozinho ao abrir (não precisou UPDATE em massa). Sem mudança de schema; reordenar usa coluna `position` que o Ops já mantém.

19. **Abas roláveis + abrir nota recente ao trocar categoria (jun/2026, v1.4.7) — só Notas, UI (TabBar.tsx + globals.css):** (a) o botão "+" e as setas ←/→ saíram de DENTRO do `.tabs-container` rolável pra FORA (sempre visíveis) — antes o "+" sumia quando enchia de abas; as setas (ChevronLeft/Right) aparecem só com overflow (`tabScroll.left/right` via scrollLeft/clientWidth/scrollWidth) e dão `scrollBy(±220)`; a aba ATIVA é rolada pra vista (`scrollIntoView`, cada aba com `data-noteid`); scrollbar escondida no CSS (navega pelas setas — estilo Notepad do Windows). (b) Ao TROCAR de categoria, abre a nota de maior `updated_at` da nova seção quando a nota ativa não é dela (`prevSectionRef` distingue troca real de re-render; respeita o efeito de auto-criar nota vazia em seção vazia).

20. **Reordenar categorias (arrastar) + concluir vai pra "Concluído" (jun/2026, v1.4.8) — só Notas:** (a) **Reordenar categorias:** arrastar as linhas no seletor de categorias (CategorySelect, DnD nativo HTML5) grava `custom_statuses.position` 0,1,2,… na nova ordem (`ops-store.reorderSections`, otimista + revert via `results.find(r=>r.error)`; **só PATCHa keys do próprio prefixo** — uma seção de sistema pode carregar a key de outro dono se o usuário não tiver row própria). Só categorias **PRÓPRIAS** (compartilhadas travadas), fora de "Todos"/impersonação (`canReorderCats = !viewAll && !viewingAs`); trava o drag quando o mouse está sobre os botões de ação da linha. Também: `refreshOpsSnapshot` passou a ordenar as seções PRÓPRIAS pela MINHA `position` (mapa `orderPos`) — sem isso a ordem das seções de SISTEMA saía por "primeiro-visto" pro DONO (que lê `custom_statuses` de todos). **⚠️ PRA O OPS:** é a MESMA coluna `position` que ordena as COLUNAS do board do Ops — reordenar no Notas reflete na ordem das colunas do Ops (inclusive as de fluxo: Em Progresso/Concluído…). Sem schema novo (o Ops já mantém `position`); nada a fazer no Ops, só ciência. (b) **Concluir → "Concluído":** removido o remap "concluída fica na origem" em 3 lugares (`TabBar.taskToSectionMap`, `CategorySelect.counts`, `NoteDetailBar.effStatus`) → a nota concluída SAI da origem e aparece na categoria "Concluído" (o backend já movia `tasks.status` pro DONE; era a EXIBIÇÃO que segurava). `completedOrigins` (localStorage) agora só serve pro **reabrir voltar à origem** (`toggleComplete` inalterado). Extras: `notifications-store.openNotification` navega pra onde a nota está agora (Concluído, fallback por sufixo); `concludeNote` foca a aba vizinha ao concluir a ATIVA; `ensure-vazia` não auto-cria nota em "Concluído" (`activeSectionId === 'DONE'`); **rede de segurança** — se a seção DONE não existir, a nota concluída fica na origem (não some). **Sem tocar o banco** (RPC `notas_complete_task` + status DONE já existem). Revisão adversarial: 0 blocker/high.
21. **SUBNOTAS + Prazo/Empresa na subnota (v1.4.10→v1.4.14) — ✅ REFLETIDO NO OPS (jul/2026):** subnota = linha em `notes` com `parent_note_id != null` E `task_id = null` → **NÃO cria task/card no Ops** (de propósito; nota RAIZ segue 1:1 com task). **Objetos novos no banco COMPARTILHADO (já aplicados na VPS):** colunas `notes.parent_note_id` (FK→notes ON DELETE CASCADE), `notes.position`, `notes.due_date` (prazo próprio da subnota, informativo); CHECK `notes_parent_note_not_self`; índices `notes_parent_note_id_idx`/`notes_parent_position_idx`; funções SECURITY DEFINER `user_can_view_note`/`user_can_edit_note` (**delegam** a `notas_can_edit_note`/`notas_editable_creator_ids`/`notas_visible_creator_ids`/`notas_category_shared_with_me` — sem isso, funcionário em CATEGORIA COMPARTILHADA não criava/via subnota nas notas do dono, era um bug); policies PERMISSIVE de subnota + 2 RESTRICTIVE (`WITH CHECK parent_note_id IS NULL OR user_can_edit_note(parent)`). Migrations (Notas): `add_note_subnotes.sql`, `harden_subnote_rls.sql`, `add_note_due_date.sql`, `fix_subnote_perms_shares.sql`. **Detalhe da subnota:** Prioridade + Empresa (`notes.client_id`) + Prazo (`notes.due_date`); Categoria/Recorrência ocultas (são da task/board). **Ops (mileto-ops2) auditado + sincronizado (commit `20d00c3`):** nada quebra (leituras de `notes` filtram por task_id; único INSERT mantém parent_note_id NULL); atualizado o model Drizzle `lib/db/schema/schema.ts` (colunas + self-FK — **fecha a armadilha do `drizzle-kit push` que apagaria as subnotas**) e a seção de subnotas em `docs/SYNC-NOTAS.md`. **Reserva de nomes:** `user_can_*_note` são do Notas; Ops não recria/derruba.

## 🛠️ MELHORIAS FUTURAS
1. **Login com Google (OAuth):** credenciais no Google Cloud (Client ID/Secret, redirect `https://supabase.miletoops.com/auth/v1/callback`) → habilitar provider no GoTrue (`ic-supabase-auth`, env `GOTRUE_EXTERNAL_GOOGLE_*`) → botão "Entrar com Google" no [src/pages/Login.tsx] (`signInWithOAuth`, tratar callback no Electron). Definir `role` inicial de quem entra pela 1ª vez.
2. **Convite por email:** SMTP no GoTrue (`GOTRUE_SMTP_*`) → fluxo de convite (tabela `invites` ou `inviteUserByEmail` via Edge Function/service_role) com `role` definido por quem convida (respeitando hierarquia) → front de convidar + aceitar. Casa com a hierarquia de cargos pendente e com `note_shares`/`category_shares`.
3. **Hierarquia de cargos (gerente→subordinados):** falta o schema da tabela de cargos do Ops; quando existir, criar `notas_pode_supervisionar(target)` + policy de SELECT em `notes`.
