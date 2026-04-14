import { create } from 'zustand'
import type { RealtimeChannel } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'
import { useNotesStore } from './notes-store'

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string

let _cachedToken: string | null = null

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

// ─── Types ────────────────────────────────────────────────────────────────────

export interface OpsSection {
  label: string
  color: string
  key_suffix: string
}

export interface OpsTask {
  id: string
  title: string
  status: string
}

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
let _lastTaskCount = -1

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
      const [statusData, taskData] = await Promise.all([
        opsFetch<{ label: string; color: string; key: string }>('custom_statuses?select=label,color,key'),
        opsFetch<{ id: string; title: string; status: string }>('tasks?select=id,title,status&order=title.asc'),
      ])

      const seen = new Set<string>()
      const newSections: OpsSection[] = []
      for (const row of statusData) {
        if (!seen.has(row.label)) {
          seen.add(row.label)
          const parts = row.key.split('_')
          newSections.push({
            label: row.label,
            color: row.color,
            key_suffix: parts[parts.length - 1],
          })
        }
      }

      const newTasks = taskData as OpsTask[]

      const currentActive = get().activeSectionId
      const stillExists =
        currentActive != null &&
        newSections.some((s) => s.key_suffix === currentActive)

      set({
        sections: newSections,
        tasks: newTasks,
        activeSectionId: stillExists ? currentActive : null,
        isSyncing: false,
        lastSyncedAt: new Date().toISOString(),
      })

      // Se o número de tasks mudou, recarregar notas (trigger pode ter criado novas)
      if (_lastTaskCount !== -1 && newTasks.length !== _lastTaskCount) {
        console.log(`[ops-sync] Task count changed (${_lastTaskCount} → ${newTasks.length}), reloading notes…`)
        void useNotesStore.getState().loadNotes()
      }
      _lastTaskCount = newTasks.length

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
   * Subscribe to Realtime changes on tasks and custom_statuses.
   * Handlers are **pure triggers** — they NEVER mutate state directly.
   */
  subscribeToOpsChanges: () => {
    const existing = get().realtimeChannel
    if (existing) {
      void supabase.removeChannel(existing)
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
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        get().scheduleOpsRefresh('window-focus')
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
