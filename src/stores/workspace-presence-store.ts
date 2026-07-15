import { create } from 'zustand'
import type { RealtimeChannel } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'
import { colorForUser } from '../lib/collab-colors'

/**
 * Presença de WORKSPACE: quem está com qual nota-RAIZ aberta AGORA, num ÚNICO canal
 * compartilhado (`presence:workspace`). Diferente da presença por-nota (Fase 1) e da
 * co-edição (Fase 2) — que só valem pra nota ATIVA —, aqui todos publicam em qual nota
 * estão, pra a TabBar mostrar uma bolinha "tem gente aqui" na aba certa. 100% efêmero
 * (não persiste, não toca `notes`/Ops). Usa o usuário REAL (não a impersonação).
 */
export interface WsPeer { userId: string; name: string; color: string }

interface WorkspacePresenceState {
  byRoot: Record<string, WsPeer[]> // nota-raiz -> peers REMOTOS nela agora (sem eu)
  join: (me: { id: string; name: string }) => void
  setCurrentRoot: (rootId: string | null) => void
  leave: () => void
}

type Meta = { user_id: string; name: string; root_id: string | null }

let _channel: RealtimeChannel | null = null
let _me: { id: string; name: string } | null = null
let _root: string | null = null

export const useWorkspacePresenceStore = create<WorkspacePresenceState>()((set) => ({
  byRoot: {},

  join: (me) => {
    if (_channel && _me?.id === me.id) { _me = me; return } // já no canal certo (só atualiza o nome)
    if (_channel) void supabase.removeChannel(_channel)
    _me = me
    const channel = supabase.channel('presence:workspace', { config: { presence: { key: me.id } } })

    // Reconstrói o mapa nota-raiz -> peers a partir do estado de presença (exclui eu mesmo,
    // dedup por userId — 2 abas do mesmo user contam 1).
    const rebuild = () => {
      const raw = channel.presenceState() as Record<string, Meta[]>
      const map: Record<string, WsPeer[]> = {}
      for (const key of Object.keys(raw)) {
        for (const m of raw[key]) {
          if (!m.root_id || m.user_id === _me?.id) continue
          const arr = (map[m.root_id] ??= [])
          if (!arr.some((p) => p.userId === m.user_id)) {
            arr.push({ userId: m.user_id, name: m.name || 'Alguém', color: colorForUser(m.user_id) })
          }
        }
      }
      set({ byRoot: map })
    }

    channel
      .on('presence', { event: 'sync' }, rebuild)
      .on('presence', { event: 'join' }, rebuild)
      .on('presence', { event: 'leave' }, rebuild)
      .subscribe((status) => {
        // Re-`track()` no SUBSCRIBED (inclui rejoin automático pós-sleep) publica a nota atual.
        if (status === 'SUBSCRIBED') void channel.track({ user_id: me.id, name: me.name, root_id: _root })
      })
    _channel = channel
  },

  setCurrentRoot: (rootId) => {
    if (_root === rootId) return // sem mudança → não re-publica
    _root = rootId
    if (_channel && _me) void _channel.track({ user_id: _me.id, name: _me.name, root_id: rootId })
  },

  leave: () => {
    if (_channel) void supabase.removeChannel(_channel)
    _channel = null; _me = null; _root = null
    set({ byRoot: {} })
  },
}))
