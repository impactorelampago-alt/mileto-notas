import { create } from 'zustand'
import type { RealtimeChannel } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'
import { useAuthStore } from './auth-store'

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

interface OpsState {
  sections: OpsSection[]
  tasks: OpsTask[]
  isLoading: boolean
  realtimeChannel: RealtimeChannel | null
  loadOpsData: () => Promise<void>
  subscribeToOpsChanges: () => void
  unsubscribeFromOpsChanges: () => void
}

export const useOpsStore = create<OpsState>()((set) => ({
  sections: [],
  tasks: [],
  isLoading: false,
  realtimeChannel: null,

  loadOpsData: async () => {
    set({ isLoading: true })
    const userId = useAuthStore.getState().user?.id
    if (!userId) { set({ isLoading: false }); return }

    try {
      const { data: statusData } = await supabase
        .from('custom_statuses')
        .select('label, color, key')

      const seen = new Set<string>()
      const sections: OpsSection[] = []
      for (const row of (statusData ?? [])) {
        if (!seen.has(row.label)) {
          seen.add(row.label)
          const parts = row.key.split('_')
          const suffix = parts[parts.length - 1]
          sections.push({ label: row.label, color: row.color, key_suffix: suffix })
        }
      }

      const { data: taskData } = await supabase
        .from('tasks')
        .select('id, title, status')
        .order('title', { ascending: true })

      const tasks = (taskData ?? []) as OpsTask[]
      const sectionsWithTasks = sections.filter(section =>
        tasks.some(t => t.status.endsWith(section.key_suffix))
      )

      set({ sections: sectionsWithTasks, tasks, isLoading: false })
    } catch {
      set({ isLoading: false })
    }
  },

  subscribeToOpsChanges: () => {
    const existing = useOpsStore.getState().realtimeChannel
    if (existing) {
      void supabase.removeChannel(existing)
    }

    const channel = supabase
      .channel('ops-changes')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'tasks' },
        async () => {
          const { data: taskData } = await supabase
            .from('tasks')
            .select('id, title, status')
            .order('title', { ascending: true })

          useOpsStore.setState({ tasks: (taskData ?? []) as OpsTask[] })
        }
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'custom_statuses' },
        async () => {
          await useOpsStore.getState().loadOpsData()
        }
      )
      .subscribe()

    useOpsStore.setState({ realtimeChannel: channel })
  },

  unsubscribeFromOpsChanges: () => {
    const channel = useOpsStore.getState().realtimeChannel
    if (channel) {
      void supabase.removeChannel(channel)
      useOpsStore.setState({ realtimeChannel: null })
    }
  },
}))
