import { create } from 'zustand'
import type { RealtimeChannel } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'
import { colorForUser } from '../lib/collab-colors'

/**
 * Presença colaborativa (Fase 1): mostra QUEM está com a mesma nota aberta e ONDE está
 * o cursor de cada um — estilo Google Sheets. Usa o Realtime do Supabase:
 *   - Presence: "quem está aqui" (nome/cor), entra/sai.
 *   - Broadcast: posição do cursor/seleção (alta frequência, efêmera).
 * NÃO persiste nada e NÃO toca `notes`/tabelas — é 100% efêmero, canal por nota.
 * (A co-edição com merge de verdade — CRDT/Yjs — é a Fase 2, separada.)
 */
export interface Peer {
  userId: string
  name: string
  color: string
  anchor: number
  head: number
  cursorAt: number // epoch ms do último cursor recebido (0 = ainda sem posição)
}

interface PresenceState {
  noteId: string | null
  meId: string | null
  meName: string | null
  peers: Record<string, Peer> // por userId, SEM eu mesmo
  channel: RealtimeChannel | null
  join: (noteId: string, me: { id: string; name: string }) => void
  /** Reconexão pós-sleep/rede: recria o canal de presença com o mesmo (noteId, me) e
   *  re-`track()`. No-op se não estou num canal. */
  resubscribe: () => void
  leave: () => void
  setLocalCursor: (anchor: number, head: number) => void
}

// Throttle do broadcast do cursor (~70ms) — suave sem inundar o canal.
const BROADCAST_MS = 70
let _lastSent = 0
let _pending: { anchor: number; head: number } | null = null
let _timer: ReturnType<typeof setTimeout> | null = null

type PresenceMeta = { user_id: string; name: string }

export const usePresenceStore = create<PresenceState>()((set, get) => {
  // (Re)cria o canal de presença + cursor pra (noteId, me). Reusado por join e resubscribe
  // (a reconexão pós-sleep recria o canal com o mesmo par sem tocar no resto do estado).
  const connect = (noteId: string, me: { id: string; name: string }) => {
    const channel = supabase.channel(`presence:note:${noteId}`, {
      config: { presence: { key: me.id } },
    })

    // Reconstrói a lista de peers a partir do estado de presença (nome/cor). Preserva a
    // última posição de cursor conhecida (que vem por broadcast, não por presence).
    const syncPeers = () => {
      const raw = channel.presenceState() as Record<string, PresenceMeta[]>
      set((s) => {
        const next: Record<string, Peer> = {}
        for (const key of Object.keys(raw)) {
          const metas = raw[key]
          const meta = metas[metas.length - 1]
          if (!meta || meta.user_id === me.id) continue
          const prev = s.peers[meta.user_id]
          next[meta.user_id] = {
            userId: meta.user_id,
            name: meta.name || 'Alguém',
            color: colorForUser(meta.user_id),
            anchor: prev?.anchor ?? 0,
            head: prev?.head ?? 0,
            cursorAt: prev?.cursorAt ?? 0,
          }
        }
        return { peers: next }
      })
    }

    channel
      .on('presence', { event: 'sync' }, syncPeers)
      .on('presence', { event: 'join' }, syncPeers)
      .on('presence', { event: 'leave' }, syncPeers)
      .on('broadcast', { event: 'cursor' }, (msg) => {
        const d = msg.payload as { user_id: string; anchor: number; head: number } | undefined
        if (!d || d.user_id === me.id) return
        set((s) => {
          const prev = s.peers[d.user_id]
          if (!prev) return s // ainda não sincronizou o presence dele — ignora
          return {
            peers: {
              ...s.peers,
              [d.user_id]: { ...prev, anchor: d.anchor, head: d.head, cursorAt: Date.now() },
            },
          }
        })
      })
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          void channel.track({ user_id: me.id, name: me.name })
        }
      })

    set({ channel })
  }

  return {
  noteId: null,
  meId: null,
  meName: null,
  peers: {},
  channel: null,

  join: (noteId, me) => {
    const st = get()
    if (st.channel && st.noteId === noteId && st.meId === me.id) return // já no canal certo
    // Sai do canal anterior antes de entrar no novo.
    if (st.channel) void supabase.removeChannel(st.channel)
    if (_timer) { clearTimeout(_timer); _timer = null }
    _pending = null
    set({ noteId, meId: me.id, meName: me.name, peers: {}, channel: null })
    connect(noteId, me)
  },

  resubscribe: () => {
    const st = get()
    if (!st.noteId || !st.meId || !st.meName) return // não estou em nenhum canal
    if (st.channel) void supabase.removeChannel(st.channel)
    set({ peers: {}, channel: null })
    connect(st.noteId, { id: st.meId, name: st.meName })
  },

  leave: () => {
    const st = get()
    if (st.channel) void supabase.removeChannel(st.channel)
    if (_timer) { clearTimeout(_timer); _timer = null }
    _pending = null
    set({ channel: null, noteId: null, meId: null, meName: null, peers: {} })
  },

  setLocalCursor: (anchor, head) => {
    if (!get().channel || !get().meId) return
    _pending = { anchor, head }
    const flush = () => {
      const ch = get().channel
      const meId = get().meId
      if (ch && meId && _pending) {
        void ch.send({
          type: 'broadcast',
          event: 'cursor',
          payload: { user_id: meId, anchor: _pending.anchor, head: _pending.head },
        })
      }
      _lastSent = Date.now()
      _pending = null
    }
    const elapsed = Date.now() - _lastSent
    if (elapsed >= BROADCAST_MS) {
      flush()
    } else if (!_timer) {
      _timer = setTimeout(() => { _timer = null; if (_pending) flush() }, BROADCAST_MS - elapsed)
    }
  },
  }
})
