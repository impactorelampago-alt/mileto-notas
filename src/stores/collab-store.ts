import { create } from 'zustand'
import * as Y from 'yjs'
import { Awareness, encodeAwarenessUpdate, applyAwarenessUpdate, removeAwarenessStates } from 'y-protocols/awareness'
import type { RealtimeChannel } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'
import { colorForUser } from '../lib/collab-colors'

/**
 * Co-edição em tempo real (Fase 2) — CRDT com Yjs.
 * - Um Y.Doc por nota (Y.Text 'content'). O merge é do Yjs → NUNCA há last-write-wins.
 * - Estado compartilhado persistido na tabela `note_yjs` (base64) → convergência entre
 *   clientes + late-joiner + offline. A sync AO VIVO é por Realtime Broadcast.
 * - `notes.content` (= tasks.description) continua markdown: o Editor faz o snapshot
 *   (ytext.toString) periodicamente via onSnapshot → mantém a integração com o Ops.
 * - Awareness (cursores/seleção com nome) roda no mesmo canal (substitui a presença
 *   da Fase 1 quando a co-edição está ligada; o y-codemirror.next desenha os cursores).
 *
 * FALHA GRACIOSA: se abrir a sessão der erro (rede/RLS), `session` fica null e o Editor
 * cai no modo simples (value/onChange) — a edição NUNCA quebra por causa da co-edição.
 */

// ── base64 <-> Uint8Array (docs de nota são pequenos; conversão direta serve) ──────
function u8ToB64(u: Uint8Array): string {
  let s = ''
  const chunk = 0x8000
  for (let i = 0; i < u.length; i += chunk) {
    s += String.fromCharCode.apply(null, Array.from(u.subarray(i, i + chunk)) as unknown as number[])
  }
  return btoa(s)
}
function b64ToU8(b: string): Uint8Array {
  const s = atob(b)
  const u = new Uint8Array(s.length)
  for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i)
  return u
}

export interface CollabSession {
  noteId: string
  doc: Y.Doc
  ytext: Y.Text
  awareness: Awareness
}

const PERSIST_MS = 2500 // debounce da gravação do estado no note_yjs + snapshot markdown

interface Internal {
  session: CollabSession | null
  channel: RealtimeChannel | null
  persistTimer: ReturnType<typeof setTimeout> | null
  onSnapshot: ((noteId: string, markdown: string) => void) | null
  updateHandler: ((update: Uint8Array, origin: unknown) => void) | null
  awarenessHandler: ((changes: { added: number[]; updated: number[]; removed: number[] }, origin: unknown) => void) | null
}

interface CollabState {
  session: CollabSession | null
  loading: boolean
  /** Abre (ou reusa) a sessão CRDT da nota. `seed` = markdown atual (pra 1ª vez). */
  open: (noteId: string, seed: string, me: { id: string; name: string }, onSnapshot: (noteId: string, markdown: string) => void) => Promise<void>
  close: () => void
}

const _i: Internal = { session: null, channel: null, persistTimer: null, onSnapshot: null, updateHandler: null, awarenessHandler: null }

async function loadState(noteId: string): Promise<Uint8Array | null> {
  const { data, error } = await supabase.from('note_yjs').select('state').eq('note_id', noteId).maybeSingle()
  if (error) { console.warn('[collab] loadState:', error.message); return null }
  if (!data?.state) return null
  try { return b64ToU8(data.state as string) } catch { return null }
}

async function persistState(noteId: string, doc: Y.Doc): Promise<void> {
  try {
    const b64 = u8ToB64(Y.encodeStateAsUpdate(doc))
    await supabase.from('note_yjs').upsert({ note_id: noteId, state: b64, updated_at: new Date().toISOString() }, { onConflict: 'note_id' })
  } catch (e) { console.warn('[collab] persistState:', e) }
}

function teardown() {
  if (_i.persistTimer) { clearTimeout(_i.persistTimer); _i.persistTimer = null }
  const s = _i.session
  if (s) {
    if (_i.updateHandler) s.doc.off('update', _i.updateHandler)
    if (_i.awarenessHandler) s.awareness.off('update', _i.awarenessHandler)
    try { removeAwarenessStates(s.awareness, [s.doc.clientID], 'local') } catch { /* noop */ }
    s.awareness.destroy()
    s.doc.destroy()
  }
  if (_i.channel) void supabase.removeChannel(_i.channel)
  _i.session = null
  _i.channel = null
  _i.updateHandler = null
  _i.awarenessHandler = null
  _i.onSnapshot = null
}

export const useCollabStore = create<CollabState>()((set, get) => ({
  session: null,
  loading: false,

  open: async (noteId, seed, me, onSnapshot) => {
    if (get().session?.noteId === noteId) return // já aberta pra esta nota
    teardown()
    set({ session: null, loading: true })

    const doc = new Y.Doc()
    const ytext = doc.getText('content')
    const awareness = new Awareness(doc)
    awareness.setLocalStateField('user', { name: me.name, color: colorForUser(me.id) })

    // 1) Carrega o estado canônico (ou semeia a partir do markdown na 1ª vez).
    let persisted: Uint8Array | null = null
    try {
      persisted = await loadState(noteId)
      if (persisted) {
        Y.applyUpdate(doc, persisted, 'load')
      } else {
        // Semeia num doc TEMP e insere como estado inicial (ON CONFLICT DO NOTHING via
        // upsert ignoreDuplicates); depois RE-LÊ o canônico e aplica no doc VAZIO — assim,
        // se outro cliente semeou primeiro, todos convergem (sem duplicar o texto).
        const seedDoc = new Y.Doc()
        seedDoc.getText('content').insert(0, seed ?? '')
        const seedUpdate = Y.encodeStateAsUpdate(seedDoc)
        seedDoc.destroy()
        await supabase.from('note_yjs')
          .upsert({ note_id: noteId, state: u8ToB64(seedUpdate), updated_at: new Date().toISOString() }, { onConflict: 'note_id', ignoreDuplicates: true })
        const canonical = await loadState(noteId)
        if (canonical) Y.applyUpdate(doc, canonical, 'load')
        else Y.applyUpdate(doc, seedUpdate, 'load') // fallback: usa a minha semente
      }
    } catch (e) {
      console.warn('[collab] open/load falhou — modo simples:', e)
      awareness.destroy(); doc.destroy()
      set({ session: null, loading: false })
      return
    }

    // 2) Canal de sync ao vivo (broadcast de updates Yjs + awareness).
    const channel = supabase.channel(`collab:note:${noteId}`, { config: { broadcast: { self: false } } })

    channel
      .on('broadcast', { event: 'yupdate' }, (msg) => {
        const d = msg.payload as { u?: string } | undefined
        if (!d?.u) return
        try { Y.applyUpdate(doc, b64ToU8(d.u), 'remote') } catch { /* update corrompido — ignora */ }
      })
      .on('broadcast', { event: 'awareness' }, (msg) => {
        const d = msg.payload as { u?: string } | undefined
        if (!d?.u) return
        try { applyAwarenessUpdate(awareness, b64ToU8(d.u), 'remote') } catch { /* noop */ }
      })
      // Sync de late-joiner: quem entra pede o estado (state vector); quem tem manda o diff.
      .on('broadcast', { event: 'sync-req' }, (msg) => {
        const d = msg.payload as { sv?: string } | undefined
        if (!d?.sv) return
        try {
          const diff = Y.encodeStateAsUpdate(doc, b64ToU8(d.sv))
          void channel.send({ type: 'broadcast', event: 'yupdate', payload: { u: u8ToB64(diff) } })
        } catch { /* noop */ }
      })
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          // Pede aos peers o que eu ainda não tenho (updates feitos antes de eu entrar no canal).
          void channel.send({ type: 'broadcast', event: 'sync-req', payload: { sv: u8ToB64(Y.encodeStateVector(doc)) } })
        }
      })

    // 3) Propaga updates locais + agenda persistência/snapshot.
    const updateHandler = (update: Uint8Array, origin: unknown) => {
      if (origin !== 'remote' && origin !== 'load') {
        void channel.send({ type: 'broadcast', event: 'yupdate', payload: { u: u8ToB64(update) } })
      }
      // Persiste o estado + snapshot markdown (debounced) — de qualquer origem, pois o
      // doc já convergiu; salvar o estado idêntico é idempotente.
      if (_i.persistTimer) clearTimeout(_i.persistTimer)
      _i.persistTimer = setTimeout(() => {
        _i.persistTimer = null
        void persistState(noteId, doc)
        _i.onSnapshot?.(noteId, ytext.toString())
      }, PERSIST_MS)
    }
    doc.on('update', updateHandler)

    const awarenessHandler = (
      changes: { added: number[]; updated: number[]; removed: number[] },
      origin: unknown,
    ) => {
      if (origin === 'remote') return
      const changed = [...changes.added, ...changes.updated, ...changes.removed]
      if (changed.length === 0) return
      void channel.send({ type: 'broadcast', event: 'awareness', payload: { u: u8ToB64(encodeAwarenessUpdate(awareness, changed)) } })
    }
    awareness.on('update', awarenessHandler)

    _i.session = { noteId, doc, ytext, awareness }
    _i.channel = channel
    _i.updateHandler = updateHandler
    _i.awarenessHandler = awarenessHandler
    _i.onSnapshot = onSnapshot
    set({ session: _i.session, loading: false })
  },

  close: () => {
    teardown()
    set({ session: null, loading: false })
  },
}))
