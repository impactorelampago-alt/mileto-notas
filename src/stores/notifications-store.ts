import { create } from 'zustand'
import type { RealtimeChannel } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'
import { useAuthStore } from './auth-store'
import { useNotesStore } from './notes-store'
import { useUIStore } from './ui-store'
import { useOpsStore, SYSTEM_SUFFIXES, HIDDEN_LEGACY_SUFFIXES } from './ops-store'
import { getStatusBase } from '../lib/status-keys'
import type { NotaNotification } from '../lib/types'

/**
 * Sino de notificações do Notas: conclusão, @menção e nota criada em categoria
 * compartilhada. Lê `notas_notifications`, gravada apenas por funções/trigger
 * do banco. Independente do sino do Mileto Ops.
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

let notificationLoadGeneration = 0
let notificationRetryTimer: ReturnType<typeof setTimeout> | null = null
let notificationRetryAttempt = 0

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
    const generation = ++notificationLoadGeneration
    const { data, error } = await supabase
      .from('notas_notifications')
      .select('*')
      .eq('recipient_id', uid)
      .order('created_at', { ascending: false })
      .limit(50)
    if (
      generation !== notificationLoadGeneration
      || useAuthStore.getState().user?.id !== uid
    ) return
    if (error) {
      console.error('[notif] loadNotifications:', error.message)
      return
    }
    const list = (data ?? []) as NotaNotification[]
    set((state) => {
      const merged = new Map(list.map((notification) => [notification.id, notification]))
      // Preserva INSERT recebido ao vivo depois que o SELECT abriu o snapshot,
      // e mantém read_at monotônico se o usuário marcou durante o request.
      for (const current of state.notifications) {
        const remote = merged.get(current.id)
        merged.set(current.id, remote
          ? { ...remote, read_at: current.read_at ?? remote.read_at }
          : current)
      }
      return {
        notifications: Array.from(merged.values())
          .sort((a, b) => b.created_at.localeCompare(a.created_at))
          .slice(0, 50),
        hasLoaded: true,
      }
    })
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

  openNotification: async (n) => {
    void get().markRead(n.id)
    set({ isOpen: false })
    const notesStore = useNotesStore.getState()
    const opsStore = useOpsStore.getState()

    // Navega pra seção onde a task da nota está (key completa; fallback por sufixo
    // p/ DONE de sistema, ex.: tarefa compartilhada conclui no DONE do dono).
    const goToSectionForTask = (taskId: string | null | undefined) => {
      if (!taskId) return
      const task = opsStore.tasks.find((t) => t.id === taskId)
      if (!task) return
      let section = opsStore.sections.find((sec) => sec.key === task.status)
      if (!section) {
        const base = getStatusBase(task.status)
        if (SYSTEM_SUFFIXES.has(base)) section = opsStore.sections.find((sec) => sec.key_suffix === base)
        if (!section && HIDDEN_LEGACY_SUFFIXES.has(base)) {
          section = opsStore.sections.find((sec) => sec.key_suffix === 'TODO')
        }
      }
      if (section) opsStore.setActiveSectionId(section.key_suffix)
    }

    // @menção: navega pela note_id e pede pro Editor piscar a linha da menção.
    if (n.type === 'mention') {
      if (!n.note_id) return
      let note = notesStore.notes.find((x) => x.id === n.note_id)
      if (!note) note = (await notesStore.fetchNoteById(n.note_id)) ?? undefined
      if (!note) return
      goToSectionForTask(note.task_id ?? n.task_id)
      notesStore.openTab(note.id)
      notesStore.setActiveTab(note.id)
      useUIStore.getState().setFlashMentionNoteId(note.id)
      return
    }

    // note_created: nova nota em categoria compartilhada. Abre por note_id (fetch se não
    // carregada) — deep-link confiável agora que o trigger dispara no INSERT da nota.
    if (n.type === 'note_created' && n.note_id) {
      let note = notesStore.notes.find((x) => x.id === n.note_id)
      if (!note) note = (await notesStore.fetchNoteById(n.note_id)) ?? undefined
      if (!note) return
      goToSectionForTask(note.task_id ?? n.task_id)
      notesStore.openTab(note.id)
      notesStore.setActiveTab(note.id)
      return
    }

    // task_completed (e note_created antigo sem note_id): abre por task_id se carregada.
    if (!n.task_id) return
    const note = notesStore.notes.find((x) => x.task_id === n.task_id)
    if (!note) return
    goToSectionForTask(n.task_id)
    notesStore.openTab(note.id)
    notesStore.setActiveTab(note.id)
  },

  subscribe: () => {
    const uid = useAuthStore.getState().user?.id
    if (!uid) return
    if (notificationRetryTimer) {
      clearTimeout(notificationRetryTimer)
      notificationRetryTimer = null
    }
    const existing = get().channel
    if (existing) {
      set({ channel: null })
      void supabase.removeChannel(existing)
    }
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
          if (get().channel !== channel) return
          const n = payload.new as NotaNotification
          set((s) => {
            if (s.notifications.some((x) => x.id === n.id)) return s
            return { notifications: [n, ...s.notifications] }
          })
          if (n.actor_id) void get().resolveActorNames([n.actor_id])
        },
      )
    set({ channel })
    channel.subscribe((status) => {
      if (get().channel !== channel) return

      if (status === 'SUBSCRIBED') {
        notificationRetryAttempt = 0
        // Fecha a janela SELECT↔assinatura: qualquer INSERT ocorrido no meio é
        // recuperado pelo snapshot idempotente (dedup por id no replace da lista).
        void get().loadNotifications()
        return
      }

      if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
        if (notificationRetryTimer) clearTimeout(notificationRetryTimer)
        const delay = Math.min(5000 * (2 ** notificationRetryAttempt), 60000)
        notificationRetryAttempt += 1
        notificationRetryTimer = setTimeout(() => {
          notificationRetryTimer = null
          if (
            get().channel !== channel
            || !useAuthStore.getState().isAuthenticated
            || useAuthStore.getState().user?.id !== uid
          ) return
          get().subscribe()
        }, delay)
      }
    })
  },

  unsubscribe: () => {
    if (notificationRetryTimer) {
      clearTimeout(notificationRetryTimer)
      notificationRetryTimer = null
    }
    notificationRetryAttempt = 0
    const ch = get().channel
    if (ch) {
      set({ channel: null })
      void supabase.removeChannel(ch)
    }
  },

  clear: () => {
    notificationLoadGeneration += 1
    set({ notifications: [], actorNames: {}, isOpen: false, hasLoaded: false })
  },
}))
