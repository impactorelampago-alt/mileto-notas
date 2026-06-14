import { create } from 'zustand'
import type { RealtimeChannel } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'
import { useNotesStore } from './notes-store'
import { useAuthStore } from './auth-store'
import { useSharingStore } from './sharing-store'
import type { NotePriority } from '../lib/types'
import { normalizePriority } from '../lib/note-priority'
import { ownerPrefixOfKey } from '../lib/sections'
import { getStatusBase, buildStatusKey } from '../lib/status-keys'

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string

let _cachedToken: string | null = null

/** Zera o token de acesso em cache. Chamado no logout para forçar re-autenticação. */
export function clearOpsAuthCache(): void {
  _cachedToken = null
}

async function opsFetch<T>(path: string): Promise<T[]> {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), 5000)

  // Usar token cacheado, ou buscar uma vez e cachear
  if (!_cachedToken) {
    try {
      const { data } = await supabase.auth.getSession()
      if (data.session?.access_token) {
        _cachedToken = data.session.access_token
      }
    } catch {
      // fallback para anon key
    }
  }

  const token = _cachedToken ?? SUPABASE_KEY

  try {
    const response = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
      headers: {
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${token}`,
      },
      signal: controller.signal,
      cache: 'no-store',
    })

    // Se receber 401, o token expirou — limpar cache e tentar de novo com anon key
    if (response.status === 401) {
      _cachedToken = null
      throw new Error('Token expired')
    }

    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    return await response.json() as T[]
  } finally {
    clearTimeout(timeoutId)
  }
}

async function opsPost<T>(table: string, body: Record<string, unknown>): Promise<T | null> {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), 5000)

  if (!_cachedToken) {
    try {
      const { data } = await supabase.auth.getSession()
      if (data.session?.access_token) {
        _cachedToken = data.session.access_token
      }
    } catch {
      // fallback para anon key
    }
  }

  const token = _cachedToken ?? SUPABASE_KEY

  try {
    const response = await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
      method: 'POST',
      headers: {
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
        'Prefer': 'return=representation',
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    })

    if (response.status === 401) {
      _cachedToken = null
      throw new Error('Token expired')
    }

    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    const rows = await response.json() as T[]
    return rows[0] ?? null
  } finally {
    clearTimeout(timeoutId)
  }
}

async function opsDelete(table: string, filter: string): Promise<{ count: number; error: string | null }> {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), 5000)

  if (!_cachedToken) {
    try {
      const { data } = await supabase.auth.getSession()
      if (data.session?.access_token) {
        _cachedToken = data.session.access_token
      }
    } catch {
      // fallback
    }
  }

  const token = _cachedToken ?? SUPABASE_KEY

  try {
    const response = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${filter}`, {
      method: 'DELETE',
      headers: {
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${token}`,
        'Prefer': 'return=representation',
      },
      signal: controller.signal,
      cache: 'no-store',
    })

    if (response.status === 401) {
      _cachedToken = null
      return { count: 0, error: 'Token expired' }
    }
    if (!response.ok) {
      const text = await response.text().catch(() => '')
      return { count: 0, error: `HTTP ${response.status} ${text}`.trim() }
    }

    const rows = await response.json().catch(() => [])
    return { count: Array.isArray(rows) ? rows.length : 0, error: null }
  } catch (err) {
    return { count: 0, error: err instanceof Error ? err.message : 'Unknown error' }
  } finally {
    clearTimeout(timeoutId)
  }
}

export function normalizeLabel(label: string): string {
  return label
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '')
}

function hexToRgba(hex: string, alpha: number): string {
  const match = /^#?([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$/.exec(hex)
  if (!match) return `rgba(0,0,0,${alpha})`
  let c = match[1]
  if (c.length === 3) c = c[0] + c[0] + c[1] + c[1] + c[2] + c[2]
  const num = parseInt(c, 16)
  return `rgba(${(num >> 16) & 255},${(num >> 8) & 255},${num & 255},${alpha})`
}

// ─── Types ────────────────────────────────────────────────────────────────────

export interface OpsSection {
  label: string
  color: string
  key_suffix: string
  /** key completa do custom_status (USR_<id>_<SUFIXO>), usada no compartilhamento. */
  key: string
  /** True quando a categoria é de OUTRO dono, compartilhada comigo. */
  shared?: boolean
  /** Id (sem hífens) do dono da categoria compartilhada. */
  ownerCleanedId?: string
  /** Permissão sobre a categoria compartilhada. */
  permission?: 'VIEW' | 'EDIT'
}

export interface OpsTask {
  id: string
  title: string
  status: string
  description: string | null
  priority: NotePriority | null
  updated_at?: string | null
}

export const SYSTEM_SUFFIXES = new Set(['TODO', 'IN_PROGRESS', 'IN_REVIEW', 'DONE', 'CANCELLED'])

// ─── State shape ──────────────────────────────────────────────────────────────

/** Domain: canonical data from Supabase */
interface OpsDomainState {
  sections: OpsSection[]
  tasks: OpsTask[]
  isLoading: boolean
  isSyncing: boolean
  syncError: string | null
  lastSyncedAt: string | null
}

/** UI: user‑driven, preserved across refreshes */
interface OpsUIState {
  activeSectionId: string | null // key_suffix of selected section
}

interface OpsActions {
  loadOpsData: () => Promise<void>
  refreshOpsSnapshot: (reason: string) => Promise<void>
  scheduleOpsRefresh: (reason: string) => void
  setActiveSectionId: (id: string | null) => void
  createSection: (label: string, color: string) => Promise<boolean>
  updateSection: (keySuffix: string, updates: { label?: string; color?: string }) => Promise<boolean>
  deleteSection: (keySuffix: string) => Promise<{ success: boolean; error?: string }>
  createTaskInOps: (title: string, sectionSuffix: string | null) => Promise<string | null>
  subscribeToOpsChanges: () => void
  unsubscribeFromOpsChanges: () => void
  setupAutoReconciliation: () => () => void
}

type OpsState = OpsDomainState & OpsUIState & OpsActions & {
  realtimeChannel: RealtimeChannel | null
}

// ─── Module‑level bookkeeping (never causes React re‑renders) ─────────────────

let _refreshTimer: ReturnType<typeof setTimeout> | null = null
let _isRefreshing = false
let _pendingRefresh = false

const DEBOUNCE_MS = 300

// ─── Store ────────────────────────────────────────────────────────────────────

export const useOpsStore = create<OpsState>()((set, get) => ({
  // ── Domain state ──────────────────────────────────────────────────────────
  sections: [],
  tasks: [],
  isLoading: false,
  isSyncing: false,
  syncError: null,
  lastSyncedAt: null,

  // ── UI state ──────────────────────────────────────────────────────────────
  activeSectionId: null,

  // ── Internal ──────────────────────────────────────────────────────────────
  realtimeChannel: null,

  // ── Actions ───────────────────────────────────────────────────────────────

  /**
   * Initial load — called once when the app starts.
   */
  loadOpsData: async () => {
    set({ isLoading: true, syncError: null })
    try {
      await get().refreshOpsSnapshot('initial-load')
    } finally {
      set({ isLoading: false })
    }
  },

  /**
   * Central, canonical refresh.
   *
   * - Fetches an atomic snapshot from the Supabase RPC `get_ops_snapshot`.
   * - Replaces domain state entirely from the snapshot.
   * - Preserves `activeSectionId` if the section still exists.
   * - NEVER closes / opens tabs.
   * - NEVER simulates a section click.
   * - If a refresh is already running, defers to run once more after completion.
   */
  refreshOpsSnapshot: async (reason: string) => {
    if (_isRefreshing) {
      _pendingRefresh = true
      console.log(`[ops-sync] Refresh deferred (in progress). Reason: ${reason}`)
      return
    }

    _isRefreshing = true
    set({ isSyncing: true, syncError: null })
    console.log(`[ops-sync] Refresh started. Reason: ${reason}`)

    try {
      const currentUserId = useAuthStore.getState().getEffectiveUserId()
      if (!currentUserId) {
        set({ isSyncing: false, syncError: 'Not authenticated' })
        _isRefreshing = false
        return
      }
      const cleanedUserId = currentUserId.replace(/-/g, '')

      // Compartilhado-comigo só aplica fora de impersonação (contexto da própria conta).
      const notImpersonating = useAuthStore.getState().viewingAs == null
      const sharedCatMap = notImpersonating
        ? useSharingStore.getState().sharedWithMeCategories
        : {}
      const sharedCatKeys = Object.keys(sharedCatMap)

      type StatusRow = { label: string; color: string; key: string; position: number }
      type TaskRow = { id: string; title: string; status: string; description: string | null; priority: NotePriority | null; updated_at: string | null }

      const [statusData, taskData] = await Promise.all([
        opsFetch<StatusRow>(
          'custom_statuses?select=label,color,key,position&order=position.asc'
        ),
        // Tarefas das MINHAS colunas (status com meu prefixo USR_<id>_, qualquer
        // assignee — pra o dono ver o board inteiro, não só o que é dele) OU
        // atribuídas a mim (pega tarefa minha numa coluna de outro). A RLS limita
        // ao que o usuário pode ver.
        opsFetch<TaskRow>(
          `tasks?select=id,title,status,description,priority,updated_at&or=(status.like.USR_${cleanedUserId}_*,assignee_id.eq.${currentUserId})&order=title.asc`
        ),
      ])

      const seen = new Set<string>()
      const newSections: OpsSection[] = []

      // statusData já vem ordenado por position (query)
      for (const row of statusData) {
        const suffix = getStatusBase(row.key)
        const isSystem = SYSTEM_SUFFIXES.has(suffix)

        // Seções pré-definidas: aparecem para todos (deduplica por label)
        // Seções custom: só aparecem se o key contém o userId do usuário logado
        if (isSystem) {
          if (!seen.has(row.label)) {
            seen.add(row.label)
            newSections.push({ label: row.label, color: row.color, key_suffix: suffix, key: row.key })
          }
        } else if (cleanedUserId && row.key.includes(cleanedUserId)) {
          if (!seen.has(row.label)) {
            seen.add(row.label)
            newSections.push({ label: row.label, color: row.color, key_suffix: suffix, key: row.key })
          }
        }
      }

      // Categorias compartilhadas COMIGO (de outro dono): adiciona a row de
      // custom_statuses correspondente, marcada shared. Evita duplicar uma key
      // que já seja minha.
      const ownKeys = new Set(newSections.map((s) => s.key))
      for (const sharedKey of sharedCatKeys) {
        if (ownKeys.has(sharedKey)) continue
        const row = statusData.find((r) => r.key === sharedKey)
        if (!row) continue
        const suffix = getStatusBase(row.key)
        const prefix = ownerPrefixOfKey(row.key)
        const ownerCleanedId = prefix ? prefix.slice(4, prefix.length - 1) : ''
        newSections.push({
          label: row.label,
          color: row.color,
          key_suffix: suffix,
          key: row.key,
          shared: true,
          ownerCleanedId,
          permission: sharedCatMap[sharedKey],
        })
        ownKeys.add(row.key)
      }

      // ── Tasks compartilhadas comigo ──────────────────────────────────────
      // (1) tasks nas categorias compartilhadas (status === key completa)
      // (2) tasks vinculadas às notas compartilhadas comigo
      const extraTaskData: TaskRow[] = []
      if (notImpersonating) {
        if (sharedCatKeys.length > 0) {
          const keyList = sharedCatKeys.map((k) => `"${k}"`).join(',')
          try {
            const rows = await opsFetch<TaskRow>(
              `tasks?select=id,title,status,description,priority,updated_at&status=in.(${keyList})`,
            )
            extraTaskData.push(...rows)
          } catch (e) {
            console.warn('[ops-sync] tasks de categorias compartilhadas:', e)
          }
        }

        const sharedNoteIds = Object.keys(useSharingStore.getState().sharedWithMeNotes)
        if (sharedNoteIds.length > 0) {
          try {
            // Resolve os task_ids das notas compartilhadas comigo (RLS autoriza o SELECT)
            const noteIdList = sharedNoteIds.map((id) => `"${id}"`).join(',')
            const noteRows = await opsFetch<{ task_id: string | null }>(
              `notes?select=task_id&id=in.(${noteIdList})`,
            )
            const sharedTaskIds = noteRows
              .map((n) => n.task_id)
              .filter((id): id is string => id !== null)
            if (sharedTaskIds.length > 0) {
              const idList = sharedTaskIds.map((id) => `"${id}"`).join(',')
              const rows = await opsFetch<TaskRow>(
                `tasks?select=id,title,status,description,priority,updated_at&id=in.(${idList})`,
              )
              extraTaskData.push(...rows)
            }
          } catch (e) {
            console.warn('[ops-sync] tasks de notas compartilhadas:', e)
          }
        }
      }

      // Merge dedup por id (próprias + compartilhadas)
      const taskById = new Map<string, TaskRow>()
      for (const t of taskData) taskById.set(t.id, t)
      for (const t of extraTaskData) if (!taskById.has(t.id)) taskById.set(t.id, t)

      const newTasks = Array.from(taskById.values()).map((task) => ({
        ...task,
        priority: normalizePriority(task.priority),
      })) as OpsTask[]

      const currentActive = get().activeSectionId
      const stillExists =
        currentActive != null &&
        (currentActive === '__sem_secao__' ||
          newSections.some((s) => s.key_suffix === currentActive))

      set({
        sections: newSections,
        tasks: newTasks,
        activeSectionId: stillExists ? currentActive : null,
        isSyncing: false,
        lastSyncedAt: new Date().toISOString(),
      })

      // Criar notas para tasks do usuário que ainda não têm nota (ex: criadas no Mileto web)
      void useNotesStore.getState().ensureNotesForOrphanTasks()

      // Sincronizar conteúdo das notas vinculadas com description das tasks
      useNotesStore.getState().syncNotesFromTaskDescriptions()

      console.log(
        `[ops-sync] Refresh complete. ${newSections.length} sections, ${newTasks.length} tasks.` +
          (currentActive && !stillExists
            ? ` activeSectionId "${currentActive}" cleared (section removed).`
            : ''),
      )
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error'
      console.error('[ops-sync] Refresh failed:', message)
      set({ syncError: message, isSyncing: false })
    } finally {
      const failed = get().syncError !== null
      _isRefreshing = false

      if (_pendingRefresh && !failed) {
        _pendingRefresh = false
        console.log('[ops-sync] Executing deferred refresh…')
        void get().refreshOpsSnapshot('deferred')
      } else {
        _pendingRefresh = false
      }
    }
  },

  /**
   * Schedule a refresh with short debounce.
   * Consolidates multiple rapid Realtime events into one RPC call.
   */
  scheduleOpsRefresh: (reason: string) => {
    if (_refreshTimer) {
      clearTimeout(_refreshTimer)
    }

    _refreshTimer = setTimeout(() => {
      _refreshTimer = null
      void get().refreshOpsSnapshot(reason)
    }, DEBOUNCE_MS)

    console.log(`[ops-sync] Refresh scheduled (${DEBOUNCE_MS}ms). Reason: ${reason}`)
  },

  /**
   * Set the active section — called only on explicit user click.
   */
  setActiveSectionId: (id: string | null) => {
    set({ activeSectionId: id })
  },

  /**
   * Cria uma seção (custom_status) no Mileto Ops, scoped ao usuário logado.
   */
  createSection: async (label: string, color: string): Promise<boolean> => {
    const userId = useAuthStore.getState().user?.id
    if (!userId) return false

    const suffix = normalizeLabel(label)
    // Key COMPLETA, sem truncar (o truncamento em 60 divergia do Ops para labels
    // longos). buildStatusKey é o helper canônico compartilhado.
    const key = buildStatusKey(userId, suffix)

    // Verificar duplicata por key_suffix nas seções atuais
    const existing = get().sections.find((s) => s.key_suffix === suffix)
    if (existing) return false

    const maxPosition = get().sections.length > 0
      ? Math.max(...get().sections.map((_, i) => i + 1))
      : 5 // Depois das 5 system

    const result = await opsPost<{ id: string }>('custom_statuses', {
      key,
      label,
      color,
      bg_color: hexToRgba(color, 0.15),
      position: maxPosition + 1,
    })

    if (!result) return false

    // Atualização otimista local + agendar refresh (Realtime também dispara)
    set((s) => ({
      sections: [...s.sections, { label, color, key_suffix: suffix, key }],
    }))
    get().scheduleOpsRefresh('section-created')
    return true
  },

  /**
   * Renomeia / recolore uma seção custom do usuário (PATCH em custom_statuses).
   * Não altera seções de sistema. O key_suffix permanece o mesmo (só muda o
   * label/cor), então as tasks/notas vinculadas continuam válidas.
   */
  updateSection: async (keySuffix: string, updates: { label?: string; color?: string }): Promise<boolean> => {
    const userId = useAuthStore.getState().user?.id
    if (!userId) return false
    if (SYSTEM_SUFFIXES.has(keySuffix)) return false

    const fullKey = buildStatusKey(userId, keySuffix)

    const prev = get().sections
    set((s) => ({
      sections: s.sections.map((sec) =>
        sec.key_suffix === keySuffix ? { ...sec, ...updates } : sec,
      ),
    }))

    const payload: Record<string, unknown> = {}
    if (updates.label !== undefined) payload.label = updates.label
    if (updates.color !== undefined) {
      payload.color = updates.color
      payload.bg_color = hexToRgba(updates.color, 0.15)
    }
    if (Object.keys(payload).length === 0) return true

    const { error } = await supabase.from('custom_statuses').update(payload).eq('key', fullKey)
    if (error) {
      console.error('[ops] updateSection:', error.message)
      set({ sections: prev })
      return false
    }
    get().scheduleOpsRefresh('section-updated')
    return true
  },

  /**
   * Deleta uma seção custom do usuário atual + todas as tasks do usuário
   * nessa seção + as notas vinculadas a essas tasks.
   * Não deleta seções pré-definidas (TODO, IN_PROGRESS, etc).
   */
  deleteSection: async (keySuffix: string): Promise<{ success: boolean; error?: string }> => {
    const userId = useAuthStore.getState().user?.id
    if (!userId) return { success: false, error: 'Usuário não autenticado' }

    if (SYSTEM_SUFFIXES.has(keySuffix)) {
      return { success: false, error: 'Não é possível excluir seções pré-definidas' }
    }

    const fullKey = buildStatusKey(userId, keySuffix)

    // 1. Tasks do usuário nessa seção
    const tasksInSection = get().tasks.filter(
      (t) => t.status === fullKey,
    )
    const taskIds = tasksInSection.map((t) => t.id)

    // 2. Deletar notas vinculadas a essas tasks
    if (taskIds.length > 0) {
      const idList = taskIds.map((id) => `"${id}"`).join(',')
      const { error: notesError } = await opsDelete('notes', `task_id=in.(${idList})`)
      if (notesError) {
        console.error('[ops] deleteSection: erro ao deletar notas:', notesError)
        return { success: false, error: `Erro ao deletar notas: ${notesError}` }
      }

      // 3. Deletar as tasks
      const { error: tasksError } = await opsDelete('tasks', `id=in.(${idList})`)
      if (tasksError) {
        console.error('[ops] deleteSection: erro ao deletar tasks:', tasksError)
        return { success: false, error: `Erro ao deletar tasks: ${tasksError}` }
      }
    }

    // 4. Deletar a custom_status
    const { error: statusError } = await opsDelete('custom_statuses', `key=eq.${fullKey}`)
    if (statusError) {
      console.error('[ops] deleteSection: erro ao deletar seção:', statusError)
      return { success: false, error: `Erro ao deletar seção: ${statusError}` }
    }

    // 5. Atualizar state local: remove seção, tasks, e abas abertas
    set((s) => ({
      sections: s.sections.filter((sec) => sec.key_suffix !== keySuffix),
      tasks: s.tasks.filter((t) => t.status !== fullKey),
      activeSectionId: s.activeSectionId === keySuffix ? null : s.activeSectionId,
    }))

    // 6. Fechar abas e remover notas locais
    const notesStore = useNotesStore.getState()
    const deletedNoteIds = new Set(
      notesStore.notes
        .filter((n) => n.task_id !== null && taskIds.includes(n.task_id))
        .map((n) => n.id),
    )
    useNotesStore.setState((s) => ({
      notes: s.notes.filter((n) => !deletedNoteIds.has(n.id)),
      openTabs: s.openTabs.filter((id) => !deletedNoteIds.has(id)),
      activeTabId: deletedNoteIds.has(s.activeTabId ?? '') ? null : s.activeTabId,
    }))

    get().scheduleOpsRefresh('section-deleted')
    console.log(`[ops] deleteSection: "${keySuffix}" removida (${taskIds.length} tasks, ${deletedNoteIds.size} notas)`)
    return { success: true }
  },

  /**
   * Cria uma task no Mileto Ops, scoped ao usuário logado.
   * Retorna o ID da task criada, ou null em caso de erro.
   */
  createTaskInOps: async (title: string, sectionSuffix: string | null): Promise<string | null> => {
    const userId = useAuthStore.getState().user?.id
    if (!userId) return null

    // SEMPRE a key COMPLETA da seção (própria OU compartilhada) — nunca reconstruir
    // pelo sufixo truncado. Se a seção não for achada, buildStatusKey monta a key
    // canônica do usuário (idêntica à do Ops).
    const targetSection = sectionSuffix
      ? get().sections.find((s) => s.key_suffix === sectionSuffix)
      : undefined
    const status = targetSection?.key ?? buildStatusKey(userId, sectionSuffix ?? 'TODO')

    const result = await opsPost<{ id: string }>('tasks', {
      title,
      status,
      priority: 'LOW',
      position: 0,
      assignee_id: userId,
      creator_id: userId,
      is_template: false,
    })

    if (!result) return null

    // Atualização otimista local + agendar refresh (Realtime também dispara)
    set((s) => ({
      tasks: [...s.tasks, { id: result.id, title, status, description: null, priority: 'LOW' }],
    }))
    get().scheduleOpsRefresh('task-created')
    return result.id
  },

  /**
   * Subscribe to Realtime changes on tasks and custom_statuses.
   * Handlers are **pure triggers** — they NEVER mutate state directly.
   */
  subscribeToOpsChanges: () => {
    const existing = get().realtimeChannel
    if (existing) {
      void supabase.removeChannel(existing)
    }

    // Mudança em shares → recarrega shares + refaz ops + notas, pra a categoria/
    // nota compartilhada aparecer NA HORA pro destinatário (sem reabrir o app).
    // O Realtime respeita RLS, então só chegam as linhas que o usuário pode ver.
    const reconcileShares = () => {
      void useSharingStore.getState().loadShares().then(() => {
        void get().refreshOpsSnapshot('realtime:shares')
        void useNotesStore.getState().loadNotes()
      })
    }

    const channel = supabase
      .channel('ops-changes')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'tasks' },
        () => {
          get().scheduleOpsRefresh('realtime:tasks')
        },
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'custom_statuses' },
        () => {
          get().scheduleOpsRefresh('realtime:custom_statuses')
        },
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'category_shares' },
        reconcileShares,
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'note_shares' },
        reconcileShares,
      )
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          console.log('[ops-sync] Realtime channel subscribed')
        }
        if (status === 'CHANNEL_ERROR') {
          console.error('[ops-sync] Realtime channel error — retrying in 5 s')
          setTimeout(() => {
            get().subscribeToOpsChanges()
          }, 5000)
        }
      })

    set({ realtimeChannel: channel })
  },

  /**
   * Unsubscribe and clean up all timers / channels.
   */
  unsubscribeFromOpsChanges: () => {
    if (_refreshTimer) {
      clearTimeout(_refreshTimer)
      _refreshTimer = null
    }

    const channel = get().realtimeChannel
    if (channel) {
      void supabase.removeChannel(channel)
      set({ realtimeChannel: null })
    }
  },

  /**
   * Auto‑reconciliation:
   * - Refresh on window focus / visibility return.
   * - Polling every 10 s to keep data fresh in background.
   * Returns a cleanup function to be called on unmount.
   */
  setupAutoReconciliation: () => {
    // Ao voltar o foco pro app: recarrega shares + refaz ops + notas (pega
    // categoria/nota compartilhada mesmo se o Realtime de shares não disparou).
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        void useSharingStore.getState().loadShares().then(() => {
          void get().refreshOpsSnapshot('window-focus')
          void useNotesStore.getState().loadNotes()
        })
      }
    }

    document.addEventListener('visibilitychange', handleVisibility)

    const pollingTimer = setInterval(() => {
      void get().refreshOpsSnapshot('polling-10s')
    }, 10_000)

    return () => {
      document.removeEventListener('visibilitychange', handleVisibility)
      clearInterval(pollingTimer)
    }
  },
}))
