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
const PERSIST_RETRIES = 5

type SnapshotHandler = (noteId: string, markdown: string, persisted: boolean) => Promise<void> | void

interface StoredState {
  update: Uint8Array
  updatedAt: string
}

interface PendingSimpleEdit {
  base: string
  target: string
  version: number
}

interface Internal {
  session: CollabSession | null
  channel: RealtimeChannel | null
  onSnapshot: SnapshotHandler | null
  updateHandler: ((update: Uint8Array, origin: unknown) => void) | null
  awarenessHandler: ((changes: { added: number[]; updated: number[]; removed: number[] }, origin: unknown) => void) | null
  peersHandler: (() => void) | null
  peersKey: string
  editable: boolean
  dirty: boolean // há mudança (minha ou de outro) ainda não persistida
  persistTicker: ReturnType<typeof setInterval> | null // grava o estado (só o cliente ELEITO)
  heartbeat: ReturnType<typeof setInterval> | null // refresca minha awareness + GC de peers obsoletos
  rewire: (() => void) | null // recria o canal de broadcast (reconexão) sem perder o Y.Doc
}

interface CollabState {
  session: CollabSession | null
  collabPeers: CollabPeer[]
  loading: boolean
  /** Abre (ou reusa) a sessão CRDT da nota. `seed` = markdown atual (pra 1ª vez).
   *  `editable=false` (viewer só-leitura): só RECEBE ao vivo — não semeia, não persiste;
   *  se ainda não existe estado CRDT, NÃO abre (o front cai no modo simples/notes.content). */
  open: (noteId: string, seed: string, me: { id: string; name: string }, onSnapshot: SnapshotHandler, editable: boolean) => Promise<void>
  /** Guarda a edição feita enquanto o estado Yjs ainda estava abrindo. O buffer é
   *  por nota: trocar rapidamente de aba não pode transferir/perder texto. */
  stageSimpleEdit: (noteId: string, base: string, target: string) => void
  /** Reconexão pós-sleep/rede: recria o canal de broadcast da sessão atual (mantém o
   *  Y.Doc) e re-dispara o sync-req. No-op se não houver sessão aberta. */
  resubscribe: () => void
  close: () => Promise<void>
}

const HEARTBEAT_MS = 15000
const AWARENESS_TIMEOUT_MS = 32000 // peer sem refrescar por > isto = obsoleto (fechou/dormiu)

const _i: Internal = { session: null, channel: null, onSnapshot: null, updateHandler: null, awarenessHandler: null, peersHandler: null, peersKey: '', editable: true, dirty: false, persistTicker: null, heartbeat: null, rewire: null }

// Uma sessão por vez: aberturas assíncronas são serializadas e recebem geração.
// Uma abertura antiga nunca pode publicar a sessão depois que o usuário já trocou.
let _openGeneration = 0
let _openChain: Promise<void> = Promise.resolve()
let _pendingVersion = 0
let _lastWriteMs = 0
const _pendingSimpleEdits = new Map<string, PendingSimpleEdit>()
const _flushQueues = new Map<string, Promise<void>>()

function nextWriteTimestamp(): string {
  const now = Date.now()
  _lastWriteMs = Math.max(now, _lastWriteMs + 1)
  return new Date(_lastWriteMs).toISOString()
}

async function loadState(noteId: string): Promise<StoredState | null> {
  const { data, error } = await supabase
    .from('note_yjs')
    .select('state,updated_at')
    .eq('note_id', noteId)
    .maybeSingle()
  if (error) throw new Error(`[collab] loadState: ${error.message}`)
  if (!data?.state) return null
  try {
    return { update: b64ToU8(data.state as string), updatedAt: data.updated_at as string }
  } catch {
    throw new Error('[collab] Estado Yjs inválido no banco')
  }
}

function markdownFromUpdate(update: Uint8Array): string {
  const doc = new Y.Doc()
  try {
    Y.applyUpdate(doc, update, 'load')
    return doc.getText('content').toString()
  } finally {
    doc.destroy()
  }
}

/**
 * Aplica a edição feita no modo simples ao documento Yjs correto.
 * No caso normal (solo), o canônico ainda é igual ao `base` e o resultado fica
 * exatamente igual ao `target`. Se houve mudança remota, aplica apenas o trecho local
 * detectado, evitando substituir o documento remoto inteiro.
 */
function applySimpleEdit(ytext: Y.Text, edit: PendingSimpleEdit): void {
  const current = ytext.toString()
  if (current === edit.target) return

  let start = 0
  const common = Math.min(edit.base.length, edit.target.length)
  while (start < common && edit.base[start] === edit.target[start]) start++

  let baseEnd = edit.base.length
  let targetEnd = edit.target.length
  while (
    baseEnd > start &&
    targetEnd > start &&
    edit.base[baseEnd - 1] === edit.target[targetEnd - 1]
  ) {
    baseEnd--
    targetEnd--
  }

  const removed = edit.base.slice(start, baseEnd)
  const inserted = edit.target.slice(start, targetEnd)

  // Documento sem mudança remota: substituição exata e mínima.
  if (current === edit.base) {
    ytext.doc?.transact(() => {
      if (removed.length > 0) ytext.delete(start, removed.length)
      if (inserted) ytext.insert(start, inserted)
    })
    return
  }

  // Documento remoto diferente: localiza com segurança o trecho removido. Se não
  // houver correspondência inequívoca, preserva o remoto e aplica só a inserção.
  let removeAt = -1
  if (removed.length > 0) {
    if (current.slice(start, start + removed.length) === removed) {
      removeAt = start
    } else {
      const first = current.indexOf(removed)
      if (first >= 0 && first === current.lastIndexOf(removed)) removeAt = first
    }
  }
  const insertAt = removeAt >= 0 ? removeAt : Math.min(start, current.length)
  ytext.doc?.transact(() => {
    if (removeAt >= 0) ytext.delete(removeAt, removed.length)
    if (inserted) ytext.insert(insertAt, inserted)
  })
}

/**
 * Persistência CRDT com compare-and-swap. O merge anterior fazia SELECT+UPSERT sem
 * trava: dois saves podiam ler o mesmo estado e o mais antigo terminar por último,
 * apagando a edição nova. `updated_at` funciona como versão; conflito relê+mescla.
 */
async function persistState(noteId: string, mine: Uint8Array): Promise<Uint8Array> {
  for (let attempt = 0; attempt < PERSIST_RETRIES; attempt++) {
    const existing = await loadState(noteId)
    const merged = existing ? Y.mergeUpdates([existing.update, mine]) : mine
    const payload = {
      note_id: noteId,
      state: u8ToB64(merged),
      updated_at: nextWriteTimestamp(),
    }

    if (!existing) {
      const { error } = await supabase.from('note_yjs').insert(payload)
      if (!error) return merged
      // Outro cliente criou entre SELECT e INSERT: relê e mescla.
      if (error.code === '23505') continue
      throw new Error(`[collab] persistState insert: ${error.message}`)
    }

    const { data, error } = await supabase
      .from('note_yjs')
      .update({ state: payload.state, updated_at: payload.updated_at })
      .eq('note_id', noteId)
      .eq('updated_at', existing.updatedAt)
      .select('note_id')

    if (error) throw new Error(`[collab] persistState update: ${error.message}`)
    if (data && data.length > 0) return merged
    // CAS perdeu: alguém gravou depois do nosso SELECT. Tenta com o estado novo.
  }
  throw new Error('[collab] persistState: concorrência excessiva após 5 tentativas')
}

function enqueueFlush(
  noteId: string,
  mine: Uint8Array,
  onSnapshot: SnapshotHandler | null,
  liveDoc?: Y.Doc,
): Promise<void> {
  const previous = _flushQueues.get(noteId) ?? Promise.resolve()
  const current = previous
    .catch(() => { /* uma tentativa anterior falhou; a fila precisa continuar */ })
    .then(async () => {
      // Primeiro cria a rede de segurança local. Se a rede cair durante o persist,
      // este texto sobrevive no electron-store e será restaurado no próximo boot.
      if (onSnapshot) await onSnapshot(noteId, markdownFromUpdate(mine), false)
      const merged = await persistState(noteId, mine)
      // Se esta ainda for a sessão viva, incorpora updates remotos que estavam apenas
      // no banco. O snapshot usa EXATAMENTE o estado confirmado, não edições posteriores.
      if (liveDoc && _i.session?.doc === liveDoc) Y.applyUpdate(liveDoc, merged, 'load')
      if (onSnapshot) await onSnapshot(noteId, markdownFromUpdate(merged), true)
    })

  _flushQueues.set(noteId, current)
  void current.then(
    () => { if (_flushQueues.get(noteId) === current) _flushQueues.delete(noteId) },
    () => { if (_flushQueues.get(noteId) === current) _flushQueues.delete(noteId) },
  )
  return current
}

async function waitForFlush(noteId: string): Promise<void> {
  const pending = _flushQueues.get(noteId)
  if (pending) await pending.catch(() => {})
}

async function waitForAllFlushes(): Promise<void> {
  const pending = Array.from(_flushQueues.values())
  if (pending.length > 0) await Promise.allSettled(pending)
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
  _i.rewire = null
}

/** Captura o update ANTES de destruir o Y.Doc e devolve o flush aguardável. */
function flushAndTeardownCurrent(): Promise<void> {
  const session = _i.session
  const snapshot = _i.onSnapshot
  const shouldFlush = !!session && _i.editable && _i.dirty
  const existingFlush = session ? _flushQueues.get(session.noteId) : null
  const finalFlush = shouldFlush && session
    ? enqueueFlush(session.noteId, Y.encodeStateAsUpdate(session.doc), snapshot)
    : (existingFlush ?? Promise.resolve())
  teardown()
  return finalFlush
}

/**
 * Rede de segurança para uma edição pré-CRDT cujo `open` falhou/cancelou.
 * `notes.content` já foi salvo pelo Editor; aqui alinhamos o `note_yjs` para ele não
 * reaparecer antigo na próxima abertura.
 */
async function flushPendingSimpleEdit(noteId: string, edit: PendingSimpleEdit): Promise<void> {
  await waitForFlush(noteId)
  const stored = await loadState(noteId)
  const doc = new Y.Doc()
  try {
    const ytext = doc.getText('content')
    if (stored) {
      Y.applyUpdate(doc, stored.update, 'load')
    } else {
      ytext.insert(0, edit.base)
    }
    applySimpleEdit(ytext, edit)
    await enqueueFlush(noteId, Y.encodeStateAsUpdate(doc), null)
    const current = _pendingSimpleEdits.get(noteId)
    if (current?.version === edit.version) _pendingSimpleEdits.delete(noteId)
  } finally {
    doc.destroy()
  }
}

async function flushAllPendingSimpleEdits(): Promise<void> {
  const entries = Array.from(_pendingSimpleEdits.entries())
  await Promise.allSettled(entries.map(([noteId, edit]) => flushPendingSimpleEdit(noteId, edit)))
}

export const useCollabStore = create<CollabState>()((set, get) => ({
  session: null,
  collabPeers: [],
  loading: false,

  open: (noteId, seed, me, onSnapshot, editable) => {
    const requestId = ++_openGeneration

    const run = async (): Promise<void> => {
      // Uma requisição velha sem texto pendente não precisa nem tocar a rede.
      if (requestId !== _openGeneration && !_pendingSimpleEdits.has(noteId)) return
      if (get().session?.noteId === noteId && requestId === _openGeneration) return

      if (_i.session) {
        const previousFlush = flushAndTeardownCurrent()
        set({ session: null, collabPeers: [], loading: requestId === _openGeneration })
        await previousFlush.catch((error: unknown) => console.warn('[collab] flush anterior:', error))
      } else if (requestId === _openGeneration) {
        set({ session: null, collabPeers: [], loading: true })
      }

      // Reabrir a mesma nota imediatamente precisa esperar o save do close anterior.
      await waitForFlush(noteId)
      if (requestId !== _openGeneration && !_pendingSimpleEdits.has(noteId)) return

      const doc = new Y.Doc()
      const ytext = doc.getText('content')
      const awareness = new Awareness(doc)
      awareness.setLocalStateField('user', { name: me.name, color: colorForUser(me.id), editable })
      const undoManager = new Y.UndoManager(ytext)

      try {
        const persisted = await loadState(noteId)
        if (persisted) {
          Y.applyUpdate(doc, persisted.update, 'load')
        } else if (!editable) {
          undoManager.destroy(); awareness.destroy(); doc.destroy()
          if (requestId === _openGeneration) set({ session: null, collabPeers: [], loading: false })
          return
        } else {
          const seedDoc = new Y.Doc()
          seedDoc.getText('content').insert(0, seed ?? '')
          const canonical = await persistState(noteId, Y.encodeStateAsUpdate(seedDoc))
          seedDoc.destroy()
          Y.applyUpdate(doc, canonical, 'load')
        }
      } catch (error) {
        console.warn('[collab] open/load falhou — modo simples:', error)
        undoManager.destroy(); awareness.destroy(); doc.destroy()
        if (requestId === _openGeneration) set({ session: null, collabPeers: [], loading: false })
        return
      }

      const staged = editable ? _pendingSimpleEdits.get(noteId) : undefined
      if (staged) applySimpleEdit(ytext, staged)

      // A nota deixou de ser ativa enquanto o SELECT estava em voo. Ainda salvamos o
      // buffer da nota CORRETA, mas ela jamais vira a sessão global atual.
      if (requestId !== _openGeneration) {
        try {
          if (staged) {
            await enqueueFlush(noteId, Y.encodeStateAsUpdate(doc), onSnapshot)
            const current = _pendingSimpleEdits.get(noteId)
            if (current?.version === staged.version) _pendingSimpleEdits.delete(noteId)
          }
        } catch (error) {
          console.warn('[collab] flush de abertura cancelada:', error)
        } finally {
          undoManager.destroy(); awareness.destroy(); doc.destroy()
        }
        return
      }

      const updateHandler = (update: Uint8Array, origin: unknown) => {
        if (origin === 'load') return
        if (origin !== 'remote') {
          void _i.channel?.send({ type: 'broadcast', event: 'yupdate', payload: { u: u8ToB64(update) } })
        }
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
        void _i.channel?.send({ type: 'broadcast', event: 'awareness', payload: { u: u8ToB64(encodeAwarenessUpdate(awareness, changed)) } })
      }
      awareness.on('update', awarenessHandler)

      const wireChannel = () => {
        if (_i.channel) void supabase.removeChannel(_i.channel)
        const channel = supabase.channel(`collab:note:${noteId}`, { config: { broadcast: { self: false } } })
        channel
          .on('broadcast', { event: 'yupdate' }, (msg) => {
            const data = msg.payload as { u?: string } | undefined
            if (!data?.u) return
            try { Y.applyUpdate(doc, b64ToU8(data.u), 'remote') } catch { /* update corrompido */ }
          })
          .on('broadcast', { event: 'awareness' }, (msg) => {
            const data = msg.payload as { u?: string } | undefined
            if (!data?.u) return
            try { applyAwarenessUpdate(awareness, b64ToU8(data.u), 'remote') } catch { /* noop */ }
          })
          .on('broadcast', { event: 'sync-req' }, (msg) => {
            const data = msg.payload as { sv?: string } | undefined
            if (!data?.sv) return
            try {
              const diff = Y.encodeStateAsUpdate(doc, b64ToU8(data.sv))
              void channel.send({ type: 'broadcast', event: 'yupdate', payload: { u: u8ToB64(diff) } })
            } catch { /* noop */ }
          })
          .subscribe((status) => {
            if (status === 'SUBSCRIBED') {
              void channel.send({ type: 'broadcast', event: 'sync-req', payload: { sv: u8ToB64(Y.encodeStateVector(doc)) } })
            }
          })
        _i.channel = channel
      }
      wireChannel()

      const refreshPeers = () => {
        const list: CollabPeer[] = []
        awareness.getStates().forEach((state, clientId) => {
          if (clientId === doc.clientID) return
          const user = (state as { user?: { name?: string; color?: string } }).user
          if (user?.name) list.push({ clientId, name: user.name, color: user.color ?? '#888' })
        })
        list.sort((a, b) => a.clientId - b.clientId)
        const key = list.map((peer) => peer.clientId + ':' + peer.name + ':' + peer.color).join('|')
        if (key === _i.peersKey) return
        _i.peersKey = key
        set({ collabPeers: list })
      }
      awareness.on('change', refreshPeers)

      const queueCurrentFlush = (): void => {
        if (!_i.dirty || !editable || _i.session?.doc !== doc) return
        _i.dirty = false
        const stagedAtFlush = _pendingSimpleEdits.get(noteId)
        void enqueueFlush(noteId, Y.encodeStateAsUpdate(doc), onSnapshot, doc).then(
          () => {
            if (stagedAtFlush && _pendingSimpleEdits.get(noteId)?.version === stagedAtFlush.version) {
              _pendingSimpleEdits.delete(noteId)
            }
          },
          (error: unknown) => {
            console.warn('[collab] persist:', error)
            if (_i.session?.doc === doc) _i.dirty = true
          },
        )
      }

      const persistTick = () => {
        if (!_i.dirty || !editable) return
        let leader = doc.clientID
        awareness.getStates().forEach((state, clientId) => {
          const user = (state as { user?: { editable?: boolean } }).user
          if (user?.editable && clientId < leader) leader = clientId
        })
        if (leader === doc.clientID) queueCurrentFlush()
      }
      const persistTicker = setInterval(persistTick, PERSIST_MS)

      const heartbeat = setInterval(() => {
        const state = awareness.getLocalState()
        if (state) awareness.setLocalState(state)
        const now = Date.now()
        const stale: number[] = []
        awareness.meta.forEach((meta, clientId) => {
          if (clientId !== doc.clientID && now - meta.lastUpdated > AWARENESS_TIMEOUT_MS) stale.push(clientId)
        })
        if (stale.length) removeAwarenessStates(awareness, stale, 'timeout')
      }, HEARTBEAT_MS)

      _i.session = { noteId, doc, ytext, awareness, undoManager }
      _i.rewire = wireChannel
      _i.updateHandler = updateHandler
      _i.awarenessHandler = awarenessHandler
      _i.peersHandler = refreshPeers
      _i.persistTicker = persistTicker
      _i.heartbeat = heartbeat
      _i.onSnapshot = onSnapshot
      _i.editable = editable
      _i.dirty = !!staged
      set({ session: _i.session, loading: false })
      refreshPeers()
      if (staged) queueCurrentFlush()
    }

    const task = _openChain.catch(() => {}).then(run)
    _openChain = task
    return task
  },

  stageSimpleEdit: (noteId, base, target) => {
    const live = _i.session?.noteId === noteId && _i.editable ? _i.session : null
    const previous = _pendingSimpleEdits.get(noteId)
    const edit: PendingSimpleEdit = {
      base: live ? live.ytext.toString() : (previous?.base ?? base),
      target,
      version: ++_pendingVersion,
    }
    _pendingSimpleEdits.set(noteId, edit)
    if (live) {
      applySimpleEdit(live.ytext, edit)
      _i.dirty = true
    }
  },

  resubscribe: () => {
    // O canal de broadcast morreu junto com o socket (sleep/rede). Recria SÓ o canal
    // (mantém Y.Doc/awareness/undo) e o SUBSCRIBED re-dispara o sync-req → recupera o que
    // passou enquanto estive fora. No-op se não há sessão aberta.
    if (!_i.session || !_i.rewire) return
    _i.rewire()
  },

  close: async () => {
    const closeGeneration = ++_openGeneration
    const sessionFlush = flushAndTeardownCurrent()
    const openingsBeforeClose = _openChain
    set({ session: null, collabPeers: [], loading: false })

    await sessionFlush.catch((error: unknown) => console.warn('[collab] close/persist:', error))
    // Uma abertura que estava no SELECT precisa terminar: se ficou velha, ela apenas
    // salva o buffer da nota correta e se autodestrói, sem publicar sessão.
    await openingsBeforeClose.catch((error: unknown) => console.warn('[collab] close/open:', error))
    await flushAllPendingSimpleEdits()
    await waitForAllFlushes()
    if (closeGeneration === _openGeneration) set({ loading: false })
  },
}))
