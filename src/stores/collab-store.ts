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
  undoManager: Y.UndoManager
}

/** Quem está com a nota aberta AGORA (via awareness), sem eu mesmo. */
export interface CollabPeer { clientId: number; name: string; color: string }

const PERSIST_MS = 2500 // debounce da gravação do estado no note_yjs + snapshot markdown

interface Internal {
  session: CollabSession | null
  channel: RealtimeChannel | null
  onSnapshot: ((noteId: string, markdown: string) => void) | null
  updateHandler: ((update: Uint8Array, origin: unknown) => void) | null
  awarenessHandler: ((changes: { added: number[]; updated: number[]; removed: number[] }, origin: unknown) => void) | null
  peersHandler: (() => void) | null
  peersKey: string
  editable: boolean
  dirty: boolean // há mudança (minha ou de outro) ainda não persistida
  persistTicker: ReturnType<typeof setInterval> | null // grava o estado (só o cliente ELEITO)
  heartbeat: ReturnType<typeof setInterval> | null // refresca minha awareness + GC de peers obsoletos
}

interface CollabState {
  session: CollabSession | null
  collabPeers: CollabPeer[]
  loading: boolean
  /** Abre (ou reusa) a sessão CRDT da nota. `seed` = markdown atual (pra 1ª vez).
   *  `editable=false` (viewer só-leitura): só RECEBE ao vivo — não semeia, não persiste;
   *  se ainda não existe estado CRDT, NÃO abre (o front cai no modo simples/notes.content). */
  open: (noteId: string, seed: string, me: { id: string; name: string }, onSnapshot: (noteId: string, markdown: string) => void, editable: boolean) => Promise<void>
  close: () => void
}

const HEARTBEAT_MS = 15000
const AWARENESS_TIMEOUT_MS = 32000 // peer sem refrescar por > isto = obsoleto (fechou/dormiu)

const _i: Internal = { session: null, channel: null, onSnapshot: null, updateHandler: null, awarenessHandler: null, peersHandler: null, peersKey: '', editable: true, dirty: false, persistTicker: null, heartbeat: null }

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
  if (_i.persistTicker) { clearInterval(_i.persistTicker); _i.persistTicker = null }
  if (_i.heartbeat) { clearInterval(_i.heartbeat); _i.heartbeat = null }
  const s = _i.session
  if (s) {
    if (_i.updateHandler) s.doc.off('update', _i.updateHandler)
    if (_i.awarenessHandler) s.awareness.off('update', _i.awarenessHandler)
    if (_i.peersHandler) s.awareness.off('change', _i.peersHandler)
    try { removeAwarenessStates(s.awareness, [s.doc.clientID], 'local') } catch { /* noop */ }
    s.undoManager.destroy()
    s.awareness.destroy()
    s.doc.destroy()
  }
  if (_i.channel) void supabase.removeChannel(_i.channel)
  _i.session = null
  _i.channel = null
  _i.updateHandler = null
  _i.awarenessHandler = null
  _i.peersHandler = null
  _i.peersKey = ''
  _i.onSnapshot = null
  _i.dirty = false
}

export const useCollabStore = create<CollabState>()((set, get) => ({
  session: null,
  collabPeers: [],
  loading: false,

  open: async (noteId, seed, me, onSnapshot, editable) => {
    if (get().session?.noteId === noteId) return // já aberta pra esta nota
    teardown()
    _i.editable = editable
    set({ session: null, collabPeers: [], loading: true })

    const doc = new Y.Doc()
    const ytext = doc.getText('content')
    const awareness = new Awareness(doc)
    // `editable` entra no estado pra a ELEIÇÃO do cliente que persiste (viewers não gravam).
    awareness.setLocalStateField('user', { name: me.name, color: colorForUser(me.id), editable })
    // Undo colaborativo: desfaz só as MINHAS edições (não as dos outros). trackedOrigins
    // default cobre as transações locais do yCollab.
    const undoManager = new Y.UndoManager(ytext)

    // 1) Carrega o estado canônico (ou semeia a partir do markdown na 1ª vez).
    let persisted: Uint8Array | null = null
    try {
      persisted = await loadState(noteId)
      if (persisted) {
        Y.applyUpdate(doc, persisted, 'load')
      } else if (!editable) {
        // Viewer só-leitura e ainda NÃO existe estado CRDT (ninguém co-editou) → não
        // semeia (a RLS bloqueia o insert) e NÃO abre sessão: o front mostra notes.content.
        undoManager.destroy(); awareness.destroy(); doc.destroy()
        set({ session: null, collabPeers: [], loading: false })
        return
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
      undoManager.destroy(); awareness.destroy(); doc.destroy()
      set({ session: null, collabPeers: [], loading: false })
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
      if (origin === 'load') return
      // Só re-transmito o que EU editei (origin local). Update de outro (remote) já veio
      // do canal — não reenvia (evita eco).
      if (origin !== 'remote') {
        void channel.send({ type: 'broadcast', event: 'yupdate', payload: { u: u8ToB64(update) } })
      }
      // Qualquer edição (minha OU de outro) deixa o doc "sujo" → o cliente ELEITO grava
      // no próximo tick. Assim o note_yjs/notes.content fica em dia com UM só gravador.
      _i.dirty = true
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

    // Barra "quem está aqui": lista de peers do awareness (nome/cor), sem eu mesmo, só
    // atualizando o store quando o CONJUNTO muda (não a cada movimento de cursor).
    const refreshPeers = () => {
      const list: CollabPeer[] = []
      awareness.getStates().forEach((st, clientId) => {
        if (clientId === doc.clientID) return
        const u = (st as { user?: { name?: string; color?: string } }).user
        if (u?.name) list.push({ clientId, name: u.name, color: u.color ?? '#888' })
      })
      list.sort((a, b) => a.clientId - b.clientId)
      const key = list.map((p) => p.clientId + ':' + p.name + ':' + p.color).join('|')
      if (key === _i.peersKey) return
      _i.peersKey = key
      set({ collabPeers: list })
    }
    awareness.on('change', refreshPeers)

    // Persistência por 1 cliente ELEITO (menor clientID entre os EDITORES presentes) —
    // grava estado + snapshot só se houver mudança pendente. Evita N clientes gravando o
    // mesmo. Se o eleito sair, o próximo menor assume no tick seguinte.
    const persistTick = () => {
      if (!_i.dirty || !editable) return
      let leader = doc.clientID
      awareness.getStates().forEach((st, cid) => {
        const u = (st as { user?: { editable?: boolean } }).user
        if (u?.editable && cid < leader) leader = cid
      })
      if (leader !== doc.clientID) return // outro cliente (menor id) é o gravador
      _i.dirty = false
      void persistState(noteId, doc)
      _i.onSnapshot?.(noteId, ytext.toString())
    }
    const persistTicker = setInterval(persistTick, PERSIST_MS)

    // Heartbeat: refresca minha awareness (pra eu não virar "obsoleto") e remove peers que
    // pararam de refrescar (fecharam/dormiram sem sair) → mata cursor-fantasma pós-sleep.
    const heartbeat = setInterval(() => {
      const st = awareness.getLocalState()
      if (st) awareness.setLocalState(st)
      const now = Date.now()
      const stale: number[] = []
      awareness.meta.forEach((m, cid) => {
        if (cid !== doc.clientID && now - m.lastUpdated > AWARENESS_TIMEOUT_MS) stale.push(cid)
      })
      if (stale.length) removeAwarenessStates(awareness, stale, 'timeout')
    }, HEARTBEAT_MS)

    _i.session = { noteId, doc, ytext, awareness, undoManager }
    _i.channel = channel
    _i.updateHandler = updateHandler
    _i.awarenessHandler = awarenessHandler
    _i.peersHandler = refreshPeers
    _i.persistTicker = persistTicker
    _i.heartbeat = heartbeat
    _i.onSnapshot = onSnapshot
    _i.dirty = false
    set({ session: _i.session, loading: false })
    refreshPeers()
  },

  close: () => {
    // Flush FINAL do snapshot/persistência pendente ANTES de destruir — não perde a
    // última edição ao trocar de nota / fechar.
    const s = _i.session
    const snap = _i.onSnapshot
    const editable = _i.editable
    const dirty = _i.dirty
    // Flush FINAL ao sair: se EU sou editor e há mudança pendente, gravo (independe da
    // eleição — o último a sair garante o save). Viewer só-leitura nunca persiste.
    if (s && editable && dirty) {
      void persistState(s.noteId, s.doc)
      snap?.(s.noteId, s.ytext.toString())
    }
    teardown()
    set({ session: null, collabPeers: [], loading: false })
  },
}))
