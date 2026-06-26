import { create } from 'zustand'
import type { RealtimeChannel } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'
import { useAuthStore } from './auth-store'
import { useNotesStore } from './notes-store'
import { useOpsStore, SYSTEM_SUFFIXES } from './ops-store'
import { getStatusBase } from '../lib/status-keys'
import type { NotaNotification } from '../lib/types'

/**
 * Sino de notificações do Notas — EXCLUSIVO para avisar conclusão de tarefa.
 * Lê a tabela `notas_notifications` (gravada por trigger no banco quando alguém
 * que não é o criador conclui a tarefa). Independente do sino do Mileto Ops.
 *
 * As notificações são sempre do usuário REAL logado (nunca do `viewingAs` da
 * impersonação): o sino é "o que concluíram PRA MIM".
 */
interface NotificationsState {
  notifications: NotaNotification[]
  actorNames: Record<string, string> // actor_id -> nome exibível
  isOpen: boolean
  hasLoaded: boolean
  channel: RealtimeChannel | null

  setOpen: (open: boolean) => void
  loadNotifications: () => Promise<void>
  resolveActorNames: (ids: string[]) => Promise<void>
  markRead: (id: string) => Promise<void>
  markAllRead: () => Promise<void>
  openNotification: (n: NotaNotification) => void
  subscribe: () => void
  unsubscribe: () => void
  clear: () => void
}

export const useNotificationsStore = create<NotificationsState>()((set, get) => ({
  notifications: [],
  actorNames: {},
  isOpen: false,
  hasLoaded: false,
  channel: null,

  setOpen: (open) => set({ isOpen: open }),

  loadNotifications: async () => {
    const uid = useAuthStore.getState().user?.id
    if (!uid) return
    const { data, error } = await supabase
      .from('notas_notifications')
      .select('*')
      .eq('recipient_id', uid)
      .order('created_at', { ascending: false })
      .limit(50)
    if (error) {
      console.error('[notif] loadNotifications:', error.message)
      return
    }
    const list = (data ?? []) as NotaNotification[]
    set({ notifications: list, hasLoaded: true })
    const actorIds = Array.from(
      new Set(list.map((n) => n.actor_id).filter((x): x is string => !!x)),
    )
    void get().resolveActorNames(actorIds)
  },

  resolveActorNames: async (ids) => {
    if (ids.length === 0) return
    const have = get().actorNames
    const team = useAuthStore.getState().teamProfiles
    const next: Record<string, string> = {}
    const missing: string[] = []
    for (const id of ids) {
      if (have[id]) continue
      const p = team.find((t) => t.id === id)
      if (p) next[id] = p.name ?? p.email
      else missing.push(id)
    }
    if (missing.length > 0) {
      const { data } = await supabase
        .from('profiles')
        .select('id,name,email')
        .in('id', missing)
      for (const row of (data ?? []) as { id: string; name: string | null; email: string }[]) {
        next[row.id] = row.name ?? row.email
      }
    }
    if (Object.keys(next).length > 0) {
      set((s) => ({ actorNames: { ...s.actorNames, ...next } }))
    }
  },

  markRead: async (id) => {
    const n = get().notifications.find((x) => x.id === id)
    if (!n || n.read_at) return
    const now = new Date().toISOString()
    set((s) => ({
      notifications: s.notifications.map((x) => (x.id === id ? { ...x, read_at: now } : x)),
    }))
    const { error } = await supabase.from('notas_notifications').update({ read_at: now }).eq('id', id)
    if (error) console.error('[notif] markRead:', error.message)
  },

  markAllRead: async () => {
    const uid = useAuthStore.getState().user?.id
    if (!uid) return
    if (!get().notifications.some((n) => !n.read_at)) return
    const now = new Date().toISOString()
    set((s) => ({
      notifications: s.notifications.map((x) => (x.read_at ? x : { ...x, read_at: now })),
    }))
    const { error } = await supabase
      .from('notas_notifications')
      .update({ read_at: now })
      .eq('recipient_id', uid)
      .is('read_at', null)
    if (error) console.error('[notif] markAllRead:', error.message)
  },

  openNotification: (n) => {
    void get().markRead(n.id)
    set({ isOpen: false })
    // Best-effort: abre a nota concluída se ela estiver carregada localmente.
    if (!n.task_id) return
    const notesStore = useNotesStore.getState()
    const note = notesStore.notes.find((x) => x.task_id === n.task_id)
    if (!note) return
    const opsStore = useOpsStore.getState()
    const task = opsStore.tasks.find((t) => t.id === n.task_id)
    if (task) {
      // A nota concluída vive na categoria "Concluído" — navega pra onde ela está
      // de fato: casa pela key COMPLETA; fallback por sufixo p/ DONE de sistema
      // (tarefa compartilhada conclui no DONE do dono, key ≠ a minha).
      let section = opsStore.sections.find((sec) => sec.key === task.status)
      if (!section) {
        const base = getStatusBase(task.status)
        if (SYSTEM_SUFFIXES.has(base)) section = opsStore.sections.find((sec) => sec.key_suffix === base)
      }
      if (section) opsStore.setActiveSectionId(section.key_suffix)
    }
    notesStore.openTab(note.id)
    notesStore.setActiveTab(note.id)
  },

  subscribe: () => {
    const uid = useAuthStore.getState().user?.id
    if (!uid) return
    const existing = get().channel
    if (existing) void supabase.removeChannel(existing)
    const channel = supabase
      .channel(`notas_notif:${uid}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'notas_notifications',
          filter: `recipient_id=eq.${uid}`,
        },
        (payload) => {
          const n = payload.new as NotaNotification
          set((s) => {
            if (s.notifications.some((x) => x.id === n.id)) return s
            return { notifications: [n, ...s.notifications] }
          })
          if (n.actor_id) void get().resolveActorNames([n.actor_id])
        },
      )
      .subscribe()
    set({ channel })
  },

  unsubscribe: () => {
    const ch = get().channel
    if (ch) {
      void supabase.removeChannel(ch)
      set({ channel: null })
    }
  },

  clear: () => set({ notifications: [], actorNames: {}, isOpen: false, hasLoaded: false }),
}))
