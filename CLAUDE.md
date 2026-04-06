# CLAUDE.md — Mileto Notas (Ops Notas)

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

URL: https://xliirrnjcsbigxxavwlr.supabase.co

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
