import { create } from 'zustand'
import type { RealtimeChannel } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'
import { useNotesStore } from './notes-store'
import { useAuthStore } from './auth-store'
import { useSharingStore } from './sharing-store'
import { useCollabStore } from './collab-store'
import { usePresenceStore } from './presence-store'
import { useCategoryGroupsStore } from './category-groups-store'
import type { NotePriority, Recurrence } from '../lib/types'
import { normalizePriority } from '../lib/note-priority'
import { ownerPrefixOfKey } from '../lib/sections'
import { getStatusBase, buildStatusKey } from '../lib/status-keys'

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string

interface OpsAuthContext {
  generation: number
  userId: string | null
  token: string
}

interface OpsRefreshAttempt {
  generation: number
  userId: string
  promise: Promise<string>
}

interface OpsResponse {
  response: Response
  context: OpsAuthContext
}

let _cachedToken: string | null = null
let _cachedUserId: string | null = null
let _authGeneration = 0
let _sessionBootstrapAllowed = true
let _refreshTokenAttempt: OpsRefreshAttempt | null = null
const _invalidatedRefreshGenerations = new Set<number>()

const OPS_REQUEST_TIMEOUT_MS = 15_000

function invalidateOpsAuth(allowSessionBootstrap: boolean): void {
  _authGeneration += 1
  _cachedToken = null
  _cachedUserId = null
  _sessionBootstrapAllowed = allowSessionBootstrap
  // A promise antiga pode terminar, mas deixa de ser reutilizável. O próprio
  // attempt também confere geração/identidade antes de publicar seu resultado.
  if (_refreshTokenAttempt) {
    _invalidatedRefreshGenerations.add(_refreshTokenAttempt.generation)
  }
  _refreshTokenAttempt = null
}

// TOKEN_REFRESHED só pode atualizar a identidade já estabelecida. Isso impede
// que o término tardio de um refresh da conta A ressuscite A após logout ou
// contamine uma sessão recém-aberta da conta B.
supabase.auth.onAuthStateChange((event, session) => {
  if (event === 'SIGNED_OUT' || !session) {
    invalidateOpsAuth(false)
    return
  }

  const nextUserId = session.user.id
  if (event === 'TOKEN_REFRESHED') {
    if (
      _invalidatedRefreshGenerations.size === 0 &&
      _sessionBootstrapAllowed &&
      _cachedUserId === nextUserId
    ) {
      _cachedToken = session.access_token
    }
    return
  }

  if (event === 'INITIAL_SESSION' || event === 'SIGNED_IN') {
    _sessionBootstrapAllowed = true
    if (_cachedUserId !== nextUserId) {
      _authGeneration += 1
      if (_refreshTokenAttempt) {
        _invalidatedRefreshGenerations.add(_refreshTokenAttempt.generation)
      }
      _refreshTokenAttempt = null
    }
    _cachedUserId = nextUserId
    _cachedToken = session.access_token
    return
  }

  // USER_UPDATED e eventos equivalentes não têm autorização para trocar a
  // identidade; podem apenas atualizar o token da sessão corrente.
  if (_sessionBootstrapAllowed && _cachedUserId === nextUserId) {
    _cachedToken = session.access_token
  }
})

/** Zera o token de acesso em cache. Chamado no logout para forçar re-autenticação. */
export function clearOpsAuthCache(allowSessionBootstrap = false): void {
  invalidateOpsAuth(allowSessionBootstrap)
}

function redactOpsError(message: string): string {
  let safe = message
  for (const secret of [SUPABASE_KEY, _cachedToken]) {
    if (secret && secret.length >= 12) safe = safe.split(secret).join('[redacted]')
  }

  return safe
    .replace(/Bearer\s+[^\s,;]+/gi, 'Bearer [redacted]')
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, '[token redacted]')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 2000)
}

function opsErrorMessage(error: unknown): string {
  return redactOpsError(error instanceof Error ? error.message : String(error))
}

async function describeHttpError(response: Response): Promise<string> {
  const rawBody = await response.text().catch(() => '')
  let detail = ''

  if (rawBody) {
    try {
      const payload = JSON.parse(rawBody) as Record<string, unknown>
      const parts: string[] = []
      if (typeof payload.code === 'string') parts.push(`[${payload.code}]`)
      if (typeof payload.message === 'string') parts.push(payload.message)
      if (typeof payload.details === 'string' && payload.details !== payload.message) {
        parts.push(`Detalhes: ${payload.details}`)
      }
      if (typeof payload.hint === 'string') parts.push(`Dica: ${payload.hint}`)
      detail = parts.join(' | ')
    } catch {
      detail = rawBody
    }
  }

  const statusText = response.statusText ? ` ${response.statusText}` : ''
  const suffix = detail ? `: ${redactOpsError(detail)}` : ''
  return `HTTP ${response.status}${statusText}${suffix}`
}

function authContextIsCurrent(context: OpsAuthContext): boolean {
  return (
    _sessionBootstrapAllowed &&
    context.generation === _authGeneration &&
    context.userId === _cachedUserId
  )
}

function assertCurrentAuthContext(context: OpsAuthContext): void {
  if (!authContextIsCurrent(context)) {
    throw new Error('A sessão mudou durante a comunicação com o Ops; a resposta anterior foi descartada')
  }
}

async function captureOpsAuthContext(): Promise<OpsAuthContext> {
  if (_cachedToken && _cachedUserId && _sessionBootstrapAllowed) {
    return { generation: _authGeneration, userId: _cachedUserId, token: _cachedToken }
  }

  if (!_sessionBootstrapAllowed) {
    throw new Error('A sessão foi encerrada durante a comunicação com o Ops')
  }

  const captureGeneration = _authGeneration

  const { data, error } = await supabase.auth.getSession()
  if (error) throw new Error(`Não foi possível obter a sessão do Ops: ${opsErrorMessage(error)}`)

  const session = data.session
  if (captureGeneration !== _authGeneration) {
    if (
      session?.user.id === _cachedUserId &&
      _cachedToken &&
      _sessionBootstrapAllowed
    ) {
      return { generation: _authGeneration, userId: _cachedUserId, token: _cachedToken }
    }
    throw new Error('A sessão mudou enquanto a autenticação do Ops era carregada')
  }

  if (!_sessionBootstrapAllowed) {
    throw new Error('A sessão foi encerrada enquanto a autenticação do Ops era carregada')
  }

  if (!session) {
    return { generation: _authGeneration, userId: null, token: SUPABASE_KEY }
  }

  if (_cachedUserId && _cachedUserId !== session.user.id) {
    throw new Error('A identidade da sessão mudou enquanto a autenticação do Ops era carregada')
  }

  if (!_cachedUserId) {
    _authGeneration += 1
    _refreshTokenAttempt = null
  }
  _cachedUserId = session.user.id
  _cachedToken = session.access_token
  return { generation: _authGeneration, userId: session.user.id, token: session.access_token }
}

async function refreshOpsToken(context: OpsAuthContext): Promise<string> {
  assertCurrentAuthContext(context)
  if (!context.userId) throw new Error('Não existe uma sessão autenticada para renovar')

  const existing = _refreshTokenAttempt
  if (
    existing &&
    existing.generation === context.generation &&
    existing.userId === context.userId
  ) {
    return existing.promise
  }

  // Single-flight: status e tasks são buscados em paralelo e podem receber 401
  // juntos. Uma única rotação evita disputar o mesmo refresh token.
  const attemptGeneration = context.generation
  const attemptUserId = context.userId
  const refreshPromise = Promise.resolve()
    .then(() => supabase.auth.refreshSession())
    .then(({ data, error }) => {
      if (error) throw new Error(opsErrorMessage(error))
      const refreshedSession = data.session
      if (!refreshedSession?.access_token) {
        throw new Error('A sessão expirou e não retornou um novo token')
      }
      if (refreshedSession.user.id !== attemptUserId) {
        throw new Error('A sessão foi renovada para outra identidade; a requisição foi cancelada')
      }
      if (
        !_sessionBootstrapAllowed ||
        _authGeneration !== attemptGeneration ||
        _cachedUserId !== attemptUserId
      ) {
        throw new Error('A sessão mudou durante a renovação; o token antigo foi descartado')
      }
      _cachedToken = refreshedSession.access_token
      return refreshedSession.access_token
    })
    .finally(() => {
      _invalidatedRefreshGenerations.delete(attemptGeneration)
      if (_refreshTokenAttempt?.promise === refreshPromise) _refreshTokenAttempt = null
    })

  _refreshTokenAttempt = {
    generation: attemptGeneration,
    userId: attemptUserId,
    promise: refreshPromise,
  }
  return refreshPromise
}

async function executeOpsRequest(path: string, init: RequestInit, token: string): Promise<Response> {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), OPS_REQUEST_TIMEOUT_MS)

  try {
    return await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
      ...init,
      headers: {
        ...init.headers,
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${token}`,
      },
      signal: controller.signal,
      cache: 'no-store',
    })
  } catch (error) {
    if (controller.signal.aborted) {
      throw new Error('Tempo limite de 15 segundos excedido na comunicação com o Ops')
    }
    throw new Error(`Falha na comunicação com o Ops: ${opsErrorMessage(error)}`)
  } finally {
    clearTimeout(timeoutId)
  }
}

async function requestOps(path: string, init: RequestInit = {}): Promise<OpsResponse> {
  const context = await captureOpsAuthContext()
  let response = await executeOpsRequest(path, init, context.token)
  assertCurrentAuthContext(context)

  if (response.status === 401) {
    const firstError = await describeHttpError(response)

    // Se outra requisição paralela já renovou o token, aproveita-o. Caso
    // contrário, força refreshSession e repete esta requisição uma única vez.
    const tokenRenewedInParallel = _cachedToken && _cachedToken !== context.token
      ? _cachedToken
      : null
    if (!tokenRenewedInParallel && _cachedToken === context.token) _cachedToken = null

    let retryToken: string
    try {
      retryToken = tokenRenewedInParallel ?? await refreshOpsToken(context)
    } catch (error) {
      throw new Error(`${firstError}. Não foi possível renovar a sessão: ${opsErrorMessage(error)}`)
    }

    assertCurrentAuthContext(context)
    response = await executeOpsRequest(path, init, retryToken)
    assertCurrentAuthContext(context)
  }

  if (!response.ok) throw new Error(await describeHttpError(response))
  assertCurrentAuthContext(context)
  return { response, context }
}

async function opsFetch<T>(path: string): Promise<T[]> {
  const { response, context } = await requestOps(path)
  const rows = await response.json() as T[]
  assertCurrentAuthContext(context)
  return rows
}

async function opsPost<T>(table: string, body: Record<string, unknown>): Promise<T | null> {
  const { response, context } = await requestOps(table, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Prefer': 'return=representation',
    },
    body: JSON.stringify(body),
  })
  const rows = await response.json() as T[]
  assertCurrentAuthContext(context)
  return rows[0] ?? null
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
  position?: number | null
  updated_at?: string | null
  due_date?: string | null
  client_id?: string | null
  recurrence?: Recurrence | null
  parent_template_id?: string | null
}

/** Empresa (clients) — só o necessário pro seletor de Empresa no detalhe. */
export interface OpsClientLite {
  id: string
  company: string | null
}

/** Sufixos legados que ainda podem existir no banco/ser usados pelo Ops. */
export const WORKFLOW_SUFFIXES = new Set(['TODO', 'IN_PROGRESS', 'IN_REVIEW', 'DONE', 'CANCELLED'])

/** Apenas Lembrete e uma categoria nativa protegida no Notas. */
export const IMMUTABLE_SUFFIXES = new Set(['TODO'])

/**
 * Colunas tecnicas/legadas que nao fazem mais parte da lista de categorias do
 * Notas. DONE continua existindo temporariamente no banco porque a conclusao do
 * Ops ainda depende dela; as demais sao migradas para TODO pela migration.
 */
export const HIDDEN_LEGACY_SUFFIXES = new Set(['IN_PROGRESS', 'IN_REVIEW', 'DONE', 'CANCELLED'])

/** Alias de compatibilidade para o casamento de status existente. */
export const SYSTEM_SUFFIXES = WORKFLOW_SUFFIXES

// ─── State shape ──────────────────────────────────────────────────────────────

/** Domain: canonical data from Supabase */
interface OpsDomainState {
  sections: OpsSection[]
  tasks: OpsTask[]
  clients: OpsClientLite[]
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
  loadClients: () => Promise<void>
  updateTaskFields: (taskId: string, fields: { status?: string; due_date?: string | null; client_id?: string | null; recurrence?: Recurrence | null; parent_template_id?: string | null }) => Promise<void>
  /** Reordena as tarefas de uma seção: grava `position` 0,1,2,… na ordem dada (reflete no board do Ops). */
  reorderTasksInSection: (orderedTaskIds: string[]) => Promise<void>
  /** Reordena as categorias: grava `position` 0,1,2,… nas custom_statuses do usuário (reflete no board do Ops). */
  reorderSections: (orderedKeys: string[]) => Promise<void>
  subscribeToOpsChanges: () => void
  unsubscribeFromOpsChanges: () => void
  setupAutoReconciliation: () => () => void
}

type OpsState = OpsDomainState & OpsUIState & OpsActions & {
  realtimeChannel: RealtimeChannel | null
  /** Saúde do canal de realtime (ops-changes) — alimenta o indicador na barra. */
  realtimeStatus: 'connecting' | 'live' | 'error'
}

// ─── Module‑level bookkeeping (never causes React re‑renders) ─────────────────

let _refreshTimer: ReturnType<typeof setTimeout> | null = null
let _retryTimer: ReturnType<typeof setTimeout> | null = null
let _isRefreshing = false
let _pendingRefresh = false

const DEBOUNCE_MS = 300

// ─── Store ────────────────────────────────────────────────────────────────────

export const useOpsStore = create<OpsState>()((set, get) => ({
  // ── Domain state ──────────────────────────────────────────────────────────
  sections: [],
  tasks: [],
  clients: [],
  isLoading: false,
  isSyncing: false,
  syncError: null,
  lastSyncedAt: null,

  // ── UI state ──────────────────────────────────────────────────────────────
  activeSectionId: null,

  // ── Internal ──────────────────────────────────────────────────────────────
  realtimeChannel: null,
  realtimeStatus: 'connecting',

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
      const viewAll = useAuthStore.getState().viewAll
      // Identidade efetiva no INÍCIO — revalidada antes do set final. Se o usuário
      // trocar de conta/impersonação durante os fetches, NÃO gravamos as tasks/seções
      // da conta antiga por cima do estado recém-limpo da nova.
      const reqViewingId = useAuthStore.getState().viewingAs?.id ?? null
      const reqViewAll = viewAll

      // Categorias/notas compartilhadas: aplica fora do modo "Todos" (no "Todos" já
      // trazemos o board inteiro da equipe). INCLUI impersonação: o dono vendo a
      // conta de um usuário precisa ver as categorias compartilhadas COM esse
      // usuário (ex.: tarefa numa categoria que o dono compartilhou com ele). O
      // sharedWithMeCategories é carregado pelo usuário EFETIVO (viewingAs) no loadShares.
      const includeShared = !viewAll
      const sharedCatMap = includeShared
        ? useSharingStore.getState().sharedWithMeCategories
        : {}
      const sharedCatKeys = Object.keys(sharedCatMap)

      type StatusRow = { label: string; color: string; key: string; position: number }
      type TaskRow = { id: string; title: string; status: string; description: string | null; priority: NotePriority | null; position: number | null; updated_at: string | null; due_date: string | null; client_id: string | null; recurrence: Recurrence | null; parent_template_id: string | null }

      // Modo "Todos": busca TODAS as tarefas (a RLS já libera o gestor/dono a ver
      // tudo). Modo normal: só as MINHAS colunas (status com meu prefixo) OU
      // atribuídas a mim. A RLS limita ao que o usuário pode ver.
      const tasksQuery = viewAll
        ? `tasks?select=id,title,status,description,priority,position,updated_at,due_date,client_id,recurrence,parent_template_id&order=title.asc`
        : `tasks?select=id,title,status,description,priority,position,updated_at,due_date,client_id,recurrence,parent_template_id&or=(status.like.USR_${cleanedUserId}_*,assignee_id.eq.${currentUserId})&order=title.asc`

      const [statusData, taskData] = await Promise.all([
        opsFetch<StatusRow>(
          'custom_statuses?select=label,color,key,position&order=position.asc'
        ),
        opsFetch<TaskRow>(tasksQuery),
      ])

      const seen = new Set<string>()
      const newSections: OpsSection[] = []
      // Ordenação das seções PRÓPRIAS pela MINHA position (key_suffix → position).
      // Necessário porque o DONO lê as colunas de TODOS: sem isto, seções de SISTEMA
      // sairiam por "primeiro-visto" (position global) e reordenar não "grudaria".
      const orderPos = new Map<string, number>()

      // statusData já vem ordenado por position (query)
      for (const row of statusData) {
        const suffix = getStatusBase(row.key)

        // No Notas, somente Lembrete e uma categoria nativa visivel. As colunas
        // legadas continuam reconhecidas para reconciliar tasks antigas, mas nao
        // aparecem como categorias selecionaveis.
        if (HIDDEN_LEGACY_SUFFIXES.has(suffix)) continue

        // Modo "Todos": agrega TODAS as colunas da equipe, deduplicadas por SUFIXO
        // (uma "Lembrete", uma "Em Progresso"...). O casamento tarefa↔seção no
        // TabBar/CategorySelect passa a ser por sufixo neste modo.
        if (viewAll) {
          if (!seen.has(suffix)) {
            seen.add(suffix)
            newSections.push({ label: row.label, color: row.color, key_suffix: suffix, key: row.key })
          }
          continue
        }

        const isSystem = WORKFLOW_SUFFIXES.has(suffix)

        // Seções de sistema (workflow do Ops: TODO/IN_PROGRESS/…): UMA por SUFIXO,
        // sempre com a key/label/cor do PRÓPRIO usuário logado. Assim a coluna não
        // DUPLICA quando o label salvo diverge entre usuários (ex.: TODO "A Fazer"
        // num usuário e "Lembrete" noutro — o dono lê os dois) e a tarefa nova cai
        // sempre na coluna certa do usuário. (Antes deduplicava por label salvo, o
        // que furava nesse caso de divergência.)
        // Seções custom: só aparecem se o key contém o userId do usuário logado.
        if (isSystem) {
          const existing = newSections.find((s) => s.key_suffix === suffix)
          const mine = cleanedUserId ? row.key.includes(cleanedUserId) : false
          if (!existing) {
            newSections.push({ label: row.label, color: row.color, key_suffix: suffix, key: row.key })
            orderPos.set(suffix, row.position)
          } else if (mine) {
            // Achou a MINHA row: prevalece (key/label/cor + ORDEM do usuário logado).
            existing.label = row.label
            existing.color = row.color
            existing.key = row.key
            orderPos.set(suffix, row.position)
          }
        } else if (cleanedUserId && row.key.includes(cleanedUserId)) {
          if (!seen.has(row.label)) {
            seen.add(row.label)
            newSections.push({ label: row.label, color: row.color, key_suffix: suffix, key: row.key })
            orderPos.set(suffix, row.position)
          }
        }
      }

      // Ordena as seções PRÓPRIAS pela minha position (as compartilhadas entram
      // depois, sempre no fim). Pra não-DONO é no-op (só as minhas rows são legíveis,
      // já vêm por position); pro DONO corrige a ordem das seções de sistema.
      if (!viewAll) {
        newSections.sort((a, b) => (orderPos.get(a.key_suffix) ?? 0) - (orderPos.get(b.key_suffix) ?? 0))
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
        // O segundo passe (categorias compartilhadas comigo) precisa respeitar
        // a mesma ocultação do passe principal; caso contrário DONE e outros
        // workflows legados voltariam à lista por meio de um share antigo.
        if (HIDDEN_LEGACY_SUFFIXES.has(suffix)) continue
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
      if (includeShared) {
        if (sharedCatKeys.length > 0) {
          const keyList = sharedCatKeys.map((k) => `"${k}"`).join(',')
          try {
            const rows = await opsFetch<TaskRow>(
              `tasks?select=id,title,status,description,priority,position,updated_at,due_date,client_id,recurrence,parent_template_id&status=in.(${keyList})`,
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
                `tasks?select=id,title,status,description,priority,position,updated_at,due_date,client_id,recurrence,parent_template_id&id=in.(${idList})`,
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

      // Troca de conta/visão durante os fetches invalida este snapshot.
      const authNow = useAuthStore.getState()
      if ((authNow.viewingAs?.id ?? null) !== reqViewingId || authNow.viewAll !== reqViewAll) {
        console.log('[ops-sync] Snapshot descartado: a conta/visão mudou durante o refresh.')
        set({ isSyncing: false })
        _isRefreshing = false
        return
      }

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

      // Carrega a nota de tasks visíveis criadas por OUTRA pessoa (coluna minha com
      // nota de terceiro, ou categoria compartilhada) — loadNotes busca por creator
      // e não pega essas. No-op quando não há nota faltando. Depois carrega as
      // SUBNOTAS dessas raízes alheias (task_id=null → não vêm por task nem creator),
      // pra a subnota criada por um aparecer pros outros no ~próximo ciclo.
      void useNotesStore.getState().loadNotesForVisibleTasks().then(() => {
        void useNotesStore.getState().loadSubnotesForLoadedRoots()
      })

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
    const auth = useAuthStore.getState()
    const userId = auth.user?.id
    if (!userId) return false

    // Criação de categoria altera o workflow do dono da key. Em "Todos" e na
    // impersonação a tela não representa a conta real do token, então é leitura.
    if (auth.viewAll || auth.viewingAs) return false

    const suffix = normalizeLabel(label)
    // Keys vazias ficam impossíveis de selecionar. Sufixos do workflow e o nome
    // visual reservado "Lembrete" não podem virar categorias custom invisíveis
    // ou duplicar o único padrão do sistema.
    if (!suffix || WORKFLOW_SUFFIXES.has(suffix) || suffix === 'LEMBRETE') {
      console.warn('[ops] createSection: nome vazio ou reservado:', label)
      return false
    }
    // Key COMPLETA, sem truncar (o truncamento em 60 divergia do Ops para labels
    // longos). buildStatusKey é o helper canônico compartilhado.
    const key = buildStatusKey(userId, suffix)

    // Verificar duplicata por key_suffix nas seções atuais
    const existing = get().sections.find((s) => s.key_suffix === suffix)
    if (existing) return false

    const maxPosition = get().sections.length > 0
      ? Math.max(...get().sections.map((_, i) => i + 1))
      : 0 // Depois do Lembrete (único default visível)

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
    if (IMMUTABLE_SUFFIXES.has(keySuffix)) return false

    const section = get().sections.find((sec) => sec.key_suffix === keySuffix)
    if (!section || section.shared) return false
    const fullKey = section.key

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
   * Exclui uma categoria sem apagar conteúdo: move suas tasks/notas para o
   * Lembrete do mesmo dono, remove compartilhamentos e só então remove a coluna.
   */
  deleteSection: async (keySuffix: string): Promise<{ success: boolean; error?: string }> => {
    const userId = useAuthStore.getState().user?.id
    if (!userId) return { success: false, error: 'Usuário não autenticado' }

    if (IMMUTABLE_SUFFIXES.has(keySuffix)) {
      return { success: false, error: 'Lembrete é a categoria padrão e não pode ser excluída' }
    }

    // "Todos" é uma visão agregada; nunca altera categorias da equipe em massa.
    if (useAuthStore.getState().viewAll) {
      return { success: false, error: 'Modo "Todos" é somente leitura' }
    }

    const sec = get().sections.find((s) => s.key_suffix === keySuffix)
    if (!sec) return { success: false, error: 'Categoria não encontrada' }
    if (sec.shared) {
      return { success: false, error: 'Não é possível excluir uma categoria compartilhada por outra pessoa' }
    }

    const fullKey = sec.key
    const tasksInSection = get().tasks.filter((task) => task.status === fullKey)
    const { error } = await supabase.rpc('notas_delete_category', {
      p_category_key: fullKey,
    })
    if (error) {
      console.error('[ops] deleteSection:', error.message)
      return { success: false, error: error.message }
    }

    const prefix = ownerPrefixOfKey(fullKey)
    const reminderKey = prefix ? `${prefix}TODO` : buildStatusKey(userId, 'TODO')

    // A RPC preserva notes/subnotas e move suas tasks atomicamente para Lembrete.
    set((state) => ({
      sections: state.sections.filter((section) => section.key_suffix !== keySuffix),
      tasks: state.tasks.map((task) =>
        task.status === fullKey ? { ...task, status: reminderKey } : task,
      ),
      activeSectionId: state.activeSectionId === keySuffix ? 'TODO' : state.activeSectionId,
    }))

    get().scheduleOpsRefresh('section-deleted')
    // A RPC também remove o vínculo pessoal dessa key. Recarrega o snapshot para
    // não ressuscitar o grupo antigo caso a mesma categoria seja recriada agora.
    void useCategoryGroupsStore.getState().loadGroups()
    console.log(`[ops] deleteSection: "${keySuffix}" removida; ${tasksInSection.length} task(s) movida(s) para Lembrete`)
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

    // Nova tarefa vai pro TOPO: position menor que todas as outras DESSE status
    // (o board ordena por position asc). Reflete no Mileto Ops (mesma coluna).
    const sameStatus = get().tasks.filter((t) => t.status === status)
    const newPosition = sameStatus.length > 0
      ? Math.min(...sameStatus.map((t) => t.position ?? 0)) - 1
      : 0

    const result = await opsPost<{ id: string }>('tasks', {
      title,
      status,
      priority: 'LOW',
      position: newPosition,
      assignee_id: userId,
      creator_id: userId,
      is_template: false,
    })

    if (!result) return null

    // Atualização otimista local + agendar refresh (Realtime também dispara)
    set((s) => ({
      tasks: [...s.tasks, { id: result.id, title, status, description: null, priority: 'LOW', position: newPosition, due_date: null, client_id: null, recurrence: null, parent_template_id: null }],
    }))
    get().scheduleOpsRefresh('task-created')
    return result.id
  },

  /** Carrega a lista de empresas (clients) pro seletor de Empresa no detalhe da nota. */
  loadClients: async () => {
    try {
      const rows = await opsFetch<OpsClientLite>('clients?select=id,company&order=company.asc')
      set({ clients: rows })
    } catch (e) {
      console.warn('[ops] loadClients:', e)
    }
  },

  /**
   * Atualiza campos da TASK vinculada (Prazo/Empresa/Recorrência) direto em
   * `tasks` (fonte de verdade do Ops). Otimista; reverte em erro.
   */
  updateTaskFields: async (taskId, fields) => {
    const prev = get().tasks
    set((s) => ({ tasks: s.tasks.map((t) => (t.id === taskId ? { ...t, ...fields } : t)) }))
    const payload: Record<string, unknown> = {}
    if (fields.status !== undefined) payload.status = fields.status
    if (fields.due_date !== undefined) payload.due_date = fields.due_date
    if (fields.client_id !== undefined) payload.client_id = fields.client_id
    if (fields.recurrence !== undefined) payload.recurrence = fields.recurrence
    if (fields.parent_template_id !== undefined) payload.parent_template_id = fields.parent_template_id
    if (Object.keys(payload).length === 0) return
    const { error } = await supabase.from('tasks').update(payload).eq('id', taskId)
    if (error) {
      console.error('[ops] updateTaskFields:', error.message)
      set({ tasks: prev })
      return
    }
    get().scheduleOpsRefresh('task-fields-updated')
  },

  reorderTasksInSection: async (orderedTaskIds) => {
    if (orderedTaskIds.length === 0) return
    // Atribui position 0,1,2,… na nova ordem e PERSISTE (reflete no board do Ops —
    // mesma coluna `position`). Otimista local; reverte se a gravação falhar.
    const prev = get().tasks
    set((s) => ({
      tasks: s.tasks.map((t) => {
        const idx = orderedTaskIds.indexOf(t.id)
        return idx >= 0 ? { ...t, position: idx } : t
      }),
    }))
    try {
      // PostgREST RESOLVE com { error } (não rejeita) em RLS/4xx — então é preciso
      // checar o .error de cada update; senão o revert do catch vira código morto.
      const results = await Promise.all(
        orderedTaskIds.map((id, i) => supabase.from('tasks').update({ position: i }).eq('id', id)),
      )
      const failed = results.find((r) => r.error)
      if (failed) {
        console.error('[ops] reorderTasksInSection — update negada, revertendo:', failed.error?.message)
        set({ tasks: prev })
        return
      }
      get().scheduleOpsRefresh('tasks-reordered')
    } catch (e) {
      console.error('[ops] reorderTasksInSection:', e)
      set({ tasks: prev })
    }
  },

  reorderSections: async (orderedKeys) => {
    if (orderedKeys.length === 0) return
    // Grava position 0,1,2,… nas custom_statuses do usuário, na ordem dada (reflete
    // no board do Ops — mesma coluna `position`). Otimista; reverte se a gravação falhar.
    // Só PATCHa as keys do PRÓPRIO usuário: uma seção de SISTEMA pode carregar a key
    // de outro dono se o usuário (DONO, que lê tudo) não tiver row própria daquele
    // sufixo; a RLS negaria o update e reverteria o reorder inteiro silenciosamente.
    const myId = useAuthStore.getState().user?.id
    const myPrefix = myId ? buildStatusKey(myId, '') : null
    const keys = myPrefix ? orderedKeys.filter((k) => k.startsWith(myPrefix)) : orderedKeys
    if (keys.length === 0) return
    const prev = get().sections
    const byKey = new Map(prev.map((s) => [s.key, s]))
    const passed = new Set(orderedKeys)
    const reordered = orderedKeys
      .map((k) => byKey.get(k))
      .filter((s): s is OpsSection => !!s)
    // Próprias não passadas (não deveria haver) antes das compartilhadas, que ficam no fim.
    const leftovers = prev.filter((s) => !s.shared && !passed.has(s.key))
    const shared = prev.filter((s) => s.shared)
    set({ sections: [...reordered, ...leftovers, ...shared] })
    try {
      // PostgREST RESOLVE com { error } (não rejeita) em RLS/4xx — checar cada update.
      const results = await Promise.all(
        keys.map((key, i) => supabase.from('custom_statuses').update({ position: i }).eq('key', key)),
      )
      const failed = results.find((r) => r.error)
      if (failed) {
        console.error('[ops] reorderSections — update negada, revertendo:', failed.error?.message)
        set({ sections: prev })
        return
      }
      get().scheduleOpsRefresh('sections-reordered')
    } catch (e) {
      console.error('[ops] reorderSections:', e)
      set({ sections: prev })
    }
  },

  /**
   * Subscribe to Realtime changes on tasks and custom_statuses.
   * Handlers are **pure triggers** — they NEVER mutate state directly.
   */
  subscribeToOpsChanges: () => {
    // Cancela um retry pendente: (re)subscrever agora (manual ou inicial) torna o
    // retry antigo redundante — sem isso ele dispararia um segundo subscribe.
    if (_retryTimer) {
      clearTimeout(_retryTimer)
      _retryTimer = null
    }
    const existing = get().realtimeChannel
    if (existing) {
      void supabase.removeChannel(existing)
    }
    set({ realtimeStatus: 'connecting' })

    // Mudança em shares → recarrega shares + refaz ops + notas, pra a categoria/
    // nota compartilhada aparecer NA HORA pro destinatário (sem reabrir o app).
    // O Realtime respeita RLS, então só chegam as linhas que o usuário pode ver.
    const reconcileShares = () => {
      // Encadeado (não paralelo): shares → snapshot (que popula tasks + chama
      // loadNotesForVisibleTasks) → loadNotes. Rodar loadNotes DEPOIS do snapshot
      // garante que a reconstrução por creator/share encontre as tasks/notas de
      // terceiro já carregadas (bloco de preservação) — sem o piscar de antes.
      void useSharingStore.getState().loadShares().then(() => {
        void get().refreshOpsSnapshot('realtime:shares').then(() => {
          void useNotesStore.getState().loadNotes()
        })
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

    // Registra o canal ANTES de assinar: o callback de status abaixo usa isso pra
    // ignorar eventos de um canal que já foi substituído/removido.
    set({ realtimeChannel: channel })

    channel.subscribe((status) => {
      // Guarda de identidade: removeChannel() do canal ANTIGO dispara 'CLOSED' no
      // callback DELE depois de já termos trocado o canal atual. Sem esta guarda,
      // esse CLOSED tardio marcaria 'error' espúrio (flicker) e re-armaria um retry
      // órfão que derrubaria o canal novo saudável (churn de ~5s). Só o canal
      // vigente reage.
      if (get().realtimeChannel !== channel) return

      if (status === 'SUBSCRIBED') {
        set({ realtimeStatus: 'live' })
        console.log('[ops-sync] Realtime channel subscribed')
      }
      // CHANNEL_ERROR / TIMED_OUT / CLOSED: o canal caiu — marca erro (alimenta o
      // indicador da barra) e re-tenta. Rastreia o retry (1 só por vez) e só
      // re-subscreve se ainda autenticado — senão um retry pendente recriaria um
      // canal órfão após logout/unmount.
      if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
        set({ realtimeStatus: 'error' })
        console.error(`[ops-sync] Realtime channel ${status} — retrying in 5 s`)
        if (_retryTimer) clearTimeout(_retryTimer)
        _retryTimer = setTimeout(() => {
          _retryTimer = null
          if (useAuthStore.getState().isAuthenticated) {
            get().subscribeToOpsChanges()
          }
        }, 5000)
      }
    })
  },

  /**
   * Unsubscribe and clean up all timers / channels.
   */
  unsubscribeFromOpsChanges: () => {
    if (_refreshTimer) {
      clearTimeout(_refreshTimer)
      _refreshTimer = null
    }
    if (_retryTimer) {
      clearTimeout(_retryTimer)
      _retryTimer = null
    }

    const channel = get().realtimeChannel
    if (channel) {
      void supabase.removeChannel(channel)
    }
    // Zera canal e status (senão o indicador ficaria preso no último valor — ex.:
    // 'error' — após logout/unmount). O CLOSED tardio do removeChannel é ignorado
    // pela guarda de identidade (realtimeChannel já é null).
    set({ realtimeChannel: null, realtimeStatus: 'connecting' })
  },

  /**
   * Auto‑reconciliation:
   * - Refresh on window focus / visibility return.
   * - Polling every 10 s to keep data fresh in background.
   * Returns a cleanup function to be called on unmount.
   */
  setupAutoReconciliation: () => {
    // Reconecta o Realtime. `force=false`: só age se o socket NÃO está aberto — no-op sem
    // churn quando saudável (`isConnected()` = estado real do socket). `force=true`:
    // reconecta SEMPRE — usado ao ACORDAR do sleep, quando o isConnected() ainda pode mentir
    // "conectado" por um socket que morreu na suspensão. Depois de sleep/queda de rede o
    // WebSocket costuma morrer CALADO (sem disparar CLOSED → sem o retry de 5s do canal).
    const reviveRealtime = (force: boolean) => {
      if (!force && supabase.realtime.isConnected()) return
      get().subscribeToOpsChanges()
      const activeId = useNotesStore.getState().activeTabId
      if (activeId) useNotesStore.getState().subscribeToNote(activeId)
      // Co-edição (Yjs) e presença: SÓ recria os canais no WAKE (force = powerMonitor).
      // No caminho frequente (poll/foco/online) o rejoin automático do socket já os revive;
      // recriar o canal de co-edição toda hora causava CHURN (broadcast perdido no meio →
      // co-edição muda). Recriar só quando realmente acordou do sleep é seguro.
      if (force) {
        useCollabStore.getState().resubscribe()
        usePresenceStore.getState().resubscribe()
      }
    }

    // Ao voltar o foco pro app: reconecta o tempo real + recarrega shares/ops/notas
    // (pega categoria/nota compartilhada mesmo se o Realtime de shares não disparou).
    const handleVisibility = () => {
      if (document.visibilityState !== 'visible') return
      reviveRealtime(false)
      void useSharingStore.getState().loadShares().then(() => {
        void get().refreshOpsSnapshot('window-focus').then(() => {
          void useNotesStore.getState().loadNotes()
        })
      })
    }
    const onNetworkRevive = () => reviveRealtime(false)
    // Electron acordou do sleep / destravou a tela → força a reconexão TOTAL (o
    // isConnected() pode mentir logo após o resume). No-op fora do Electron (web).
    const onPowerResume = () => reviveRealtime(true)

    document.addEventListener('visibilitychange', handleVisibility)
    window.addEventListener('online', onNetworkRevive)
    window.addEventListener('focus', onNetworkRevive)
    window.electronAPI?.power?.onResume(onPowerResume)

    const pollingTimer = setInterval(() => {
      reviveRealtime(false) // rede de segurança: reconecta em ≤10s se o socket caiu calado
      void get().refreshOpsSnapshot('polling-10s')
    }, 10_000)

    return () => {
      document.removeEventListener('visibilitychange', handleVisibility)
      window.removeEventListener('online', onNetworkRevive)
      window.removeEventListener('focus', onNetworkRevive)
      clearInterval(pollingTimer)
    }
  },
}))
