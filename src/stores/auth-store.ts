import { create } from 'zustand'
import type { Session, User } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'
import { useCollaboratorsStore } from './collaborators-store'
import { useNotesStore, clearNotesAuthCache, bumpViewGeneration } from './notes-store'
import { useOpsStore, clearOpsAuthCache } from './ops-store'
import { useSharingStore } from './sharing-store'
import { useNotificationsStore } from './notifications-store'
import { useCategoryGroupsStore } from './category-groups-store'
import { useCategoriesStore } from './categories-store'
import { usePresenceStore } from './presence-store'
import { useWorkspacePresenceStore } from './workspace-presence-store'
import { useCollabStore } from './collab-store'
import { useEditsStore } from './edits-store'
import { useMediaStore } from './media-store'
import type { Note, Profile } from '../lib/types'

interface AuthState {
  user: User | null
  profile: Profile | null
  isLoading: boolean
  isAuthenticated: boolean
  /** Sessão de senha válida, mas ainda aguardando o segundo fator TOTP. */
  mfaRequired: boolean
  /** Erro de segurança da sessão que precisa aparecer mesmo fora de um submit. */
  authError: string | null
  /** Fator selecionado para o desafio. Mantido no store para não ir para a UI. */
  pendingMfaFactorId: string | null
  /** Todos os perfis da equipe (para o seletor de contas). */
  teamProfiles: Profile[]
  /** Conta que está sendo visualizada (impersonação). null = a própria conta. */
  viewingAs: Profile | null
  /** Modo "Todos": agrega as notas de TODA a equipe (visão geral, só leitura). */
  viewAll: boolean
  initialize: () => Promise<void>
  signIn: (email: string, password: string) => Promise<{ error: string | null; mfaRequired: boolean }>
  verifyMfa: (code: string) => Promise<{ error: string | null }>
  cancelMfa: () => Promise<void>
  signOut: () => Promise<void>
  loadProfile: (userId: string) => Promise<void>
  loadTeamProfiles: () => Promise<void>
  setViewingAs: (profile: Profile | null) => Promise<void>
  /** Entra/sai do modo "Todos" (visão geral de toda a equipe — leitura). */
  setViewAll: (on: boolean) => Promise<void>
  /** ID do usuário cujas notas/tasks devem ser carregadas (impersonação ou próprio). */
  getEffectiveUserId: () => string | undefined
  /** True se o usuário REAL logado é o DONO (role DONO) — tem controle total. */
  isDono: () => boolean
  /**
   * True se o usuário REAL pode EXCLUIR a nota: é o criador, OU é DONO, OU tem
   * cargo com EDITAR sobre o criador (editableIds). Sempre avalia pelo usuário
   * REAL (nunca viewingAs). A exclusão de nota de terceiro vai por RPC validado.
   */
  canDeleteNote: (note: Note) => boolean
  /**
   * True se o usuário REAL pode EDITAR o conteúdo da nota: criador, OU DONO, OU
   * compartilhada-EDIT, OU cargo com EDITAR sobre o criador (editableIds). NÃO
   * considera o modo "Todos" (some leitura) — o chamador combina com `!viewAll`.
   * Regra única reusada pelo Editor (só-leitura) e pelo TabBar (dot/renomear).
   */
  canEditNote: (note: Note) => boolean
  /**
   * True se o usuário REAL é dono da categoria (custom_status). Dono = role DONO
   * ou a key começa com `USR_<meuIdLimpo>_`. Categorias compartilhadas comigo
   * (de outro dono) retornam false.
   */
  isCategoryOwner: (sectionFullKey: string) => boolean
  /** Ids de criadores que o usuário REAL pode VER pela árvore de núcleos. null = não carregado. */
  visibleIds: Set<string> | null
  /** Ids de criadores que o usuário REAL pode EDITAR (cargo_edit; DONO = todos). */
  editableIds: Set<string> | null
  /** Carrega os conjuntos VER/EDITAR (RPCs notas_visible/editable_creator_ids). */
  loadPermissionSets: () => Promise<void>
}

function translateAuthError(message: string): string {
  if (message.includes('Invalid API key')) return 'Configuração inválida: a chave do Supabase não corresponde à URL. Verifique o .env.'
  if (message.includes('Invalid login credentials')) return 'Email ou senha incorretos.'
  if (message.includes('Email not confirmed')) return 'Email não confirmado. Verifique sua caixa de entrada.'
  if (message.includes('Too many requests')) return 'Muitas tentativas. Aguarde um momento e tente novamente.'
  if (
    message.includes('fetch') ||
    message.includes('network') ||
    message.includes('Failed to fetch')
  )
    return 'Erro de conexão. Verifique sua internet.'
  return 'Erro ao entrar. Tente novamente.'
}

function translateMfaError(message: string): string {
  const normalized = message.toLowerCase()
  if (
    normalized.includes('invalid totp') ||
    normalized.includes('invalid mfa') ||
    normalized.includes('invalid code') ||
    normalized.includes('verification failed')
  ) {
    return 'Código inválido. Confira o aplicativo autenticador e tente novamente.'
  }
  if (normalized.includes('expired')) {
    return 'O código expirou. Use o código atual do aplicativo autenticador.'
  }
  if (normalized.includes('too many') || normalized.includes('rate limit')) {
    return 'Muitas tentativas. Aguarde um momento e tente novamente.'
  }
  if (
    normalized.includes('fetch') ||
    normalized.includes('network') ||
    normalized.includes('failed to fetch')
  ) {
    return 'Erro de conexão. Verifique sua internet.'
  }
  return 'Não foi possível confirmar o código. Tente novamente.'
}

export const useAuthStore = create<AuthState>()((set, get) => {
  let authEvaluationGeneration = 0
  let authListenerRegistered = false
  let initializationPromise: Promise<void> | null = null

  type SessionGateResult = {
    authenticated: boolean
    mfaRequired: boolean
    error: string | null
  }

  /** Limpeza local síncrona e idempotente; não chama nenhum método de auth. */
  const cleanupSessionState = (allowOpsSessionBootstrap = false) => {
    bumpViewGeneration()
    set({
      user: null,
      profile: null,
      isAuthenticated: false,
      mfaRequired: false,
      authError: null,
      pendingMfaFactorId: null,
      viewingAs: null,
      viewAll: false,
      teamProfiles: [],
      visibleIds: null,
      editableIds: null,
    })

    clearNotesAuthCache()
    clearOpsAuthCache(allowOpsSessionBootstrap)
    useNotesStore.getState().unsubscribeFromNote()
    useOpsStore.getState().unsubscribeFromOpsChanges()
    useNotificationsStore.getState().unsubscribe()
    useNotificationsStore.getState().clear()
    usePresenceStore.getState().leave()
    useWorkspacePresenceStore.getState().leave()
    void useCollabStore.getState().close()
    useCollaboratorsStore.getState().resetStore()
    useCategoryGroupsStore.getState().clear()

    useSharingStore.setState({
      categoryShares: {},
      noteShares: {},
      sharedWithMeNotes: {},
      sharedWithMeCategories: {},
    })
    // O cache persistido de compartilhamento é preservado: versões antigas podem
    // tê-lo usado como fallback. Apenas o snapshot em memória troca de identidade.
    useCategoriesStore.setState({ categories: [], isLoading: false })
    useEditsStore.setState({ editsByNote: {} })
    useMediaStore.setState({
      mediaByNote: {},
      urlByPath: {},
      uploadingByNote: {},
      copyingId: null,
    })
    useNotesStore.setState({
      notes: [],
      openTabs: [],
      activeTabId: null,
      isLoading: false,
      hasLoadedOnce: false,
      completedOrigins: {},
      pendingSync: 0,
      noteIdsWithCollaborators: new Set(),
      realtimeChannel: null,
    })
    useOpsStore.setState({
      sections: [],
      tasks: [],
      clients: [],
      activeSectionId: null,
      isLoading: false,
      isSyncing: false,
      syncError: null,
      lastSyncedAt: null,
      realtimeChannel: null,
      realtimeStatus: 'connecting',
    })
  }

  const loadProfileForGate = async (
    userId: string,
    evaluationId: number,
  ): Promise<{ profile: Profile | null; stale: boolean }> => {
    const { data, error } = await supabase.from('profiles').select('*').eq('id', userId).single()
    const stale = evaluationId !== authEvaluationGeneration || get().user?.id !== userId
    if (stale) return { profile: null, stale: true }
    if (error) console.error('[auth] loadProfile:', error.message)
    return { profile: data ? data as Profile : null, stale: false }
  }

  const publishAuthenticatedSession = async (
    session: Session,
    evaluationId: number,
  ): Promise<boolean> => {
    const loaded = await loadProfileForGate(session.user.id, evaluationId)
    if (loaded.stale) return false
    set({
      user: session.user,
      profile: loaded.profile,
      isAuthenticated: true,
      mfaRequired: false,
      pendingMfaFactorId: null,
      authError: null,
    })
    return true
  }

  /**
   * Decide se uma sessão pode abrir o app. A existência da sessão de senha (AAL1)
   * nunca é suficiente quando o Supabase informa que ela pode/deve subir para AAL2.
   */
  const evaluateSession = async (
    session: Session,
    evaluationId = ++authEvaluationGeneration,
  ): Promise<SessionGateResult> => {
    try {
      if (evaluationId !== authEvaluationGeneration) {
        return { authenticated: false, mfaRequired: false, error: null }
      }
      if (get().user?.id !== session.user.id) {
        set({ user: session.user, profile: null, isAuthenticated: false })
      }
      const { data: assurance, error: assuranceError } =
        await supabase.auth.mfa.getAuthenticatorAssuranceLevel()

      if (evaluationId !== authEvaluationGeneration) {
        return {
          authenticated: get().isAuthenticated,
          mfaRequired: get().mfaRequired,
          error: null,
        }
      }

      if (assuranceError || !assurance) {
        const message = assuranceError
          ? translateMfaError(assuranceError.message)
          : 'Não foi possível verificar a segurança da sessão. Entre novamente.'
        set({
          user: session.user,
          profile: null,
          isAuthenticated: false,
          mfaRequired: false,
          pendingMfaFactorId: null,
          authError: message,
        })
        return { authenticated: false, mfaRequired: false, error: message }
      }

      // Uma sessão que já possui AAL2 não deve pedir o código novamente.
      if (assurance.currentLevel === 'aal2') {
        const authenticated = await publishAuthenticatedSession(session, evaluationId)
        return { authenticated, mfaRequired: false, error: null }
      }

      // nextLevel=aal2 significa que há fator verificado e a sessão AAL1 não pode
      // atravessar o gate. listFactors().totp contém somente fatores verificados.
      if (assurance.nextLevel === 'aal2') {
        const { data: factors, error: factorsError } = await supabase.auth.mfa.listFactors()

        if (evaluationId !== authEvaluationGeneration) {
          return {
            authenticated: get().isAuthenticated,
            mfaRequired: get().mfaRequired,
            error: null,
          }
        }

        const sessionTotp = session.user.factors?.find(
          (factor) => factor.factor_type === 'totp' && factor.status === 'verified',
        )
        const factorId = factors?.totp[0]?.id ?? sessionTotp?.id ?? null

        if (factorsError && !factorId) {
          const message = translateMfaError(factorsError.message)
          set({
            user: session.user,
            profile: null,
            isAuthenticated: false,
            mfaRequired: false,
            pendingMfaFactorId: null,
            authError: message,
          })
          return { authenticated: false, mfaRequired: false, error: message }
        }

        if (!factorId) {
          const message = 'Esta conta exige um segundo fator TOTP, mas nenhum autenticador compatível foi encontrado.'
          set({
            user: session.user,
            profile: null,
            isAuthenticated: false,
            mfaRequired: true,
            pendingMfaFactorId: null,
            authError: message,
          })
          return { authenticated: false, mfaRequired: true, error: message }
        }

        set({
          user: session.user,
          profile: null,
          isAuthenticated: false,
          mfaRequired: true,
          pendingMfaFactorId: factorId,
          authError: null,
        })
        return { authenticated: false, mfaRequired: true, error: null }
      }

      // Conta sem fator MFA: preserva o fluxo atual de senha.
      const authenticated = await publishAuthenticatedSession(session, evaluationId)
      return { authenticated, mfaRequired: false, error: null }
    } catch (error) {
      if (evaluationId !== authEvaluationGeneration) {
        return {
          authenticated: get().isAuthenticated,
          mfaRequired: get().mfaRequired,
          error: null,
        }
      }
      const message = translateMfaError(error instanceof Error ? error.message : String(error))
      set({
        user: session.user,
        profile: null,
        isAuthenticated: false,
        mfaRequired: false,
        pendingMfaFactorId: null,
        authError: message,
      })
      return { authenticated: false, mfaRequired: false, error: message }
    }
  }

  const registerAuthListener = () => {
    if (authListenerRegistered) return
    authListenerRegistered = true

    supabase.auth.onAuthStateChange((event, session) => {
      const evaluationId = ++authEvaluationGeneration

      if (event === 'SIGNED_OUT' || !session) {
        cleanupSessionState()
        return
      }

      // Também cobre troca de conta propagada por outra janela/aba sem um
      // SIGNED_OUT intermediário: nenhum snapshot da identidade anterior sobrevive.
      const previousUserId = get().user?.id
      if (previousUserId && previousUserId !== session.user.id) {
        // O evento já carrega a sessão nova. Permite ao Ops reidratá-la mesmo se
        // seu listener tiver sido executado antes desta limpeza.
        cleanupSessionState(true)
      }

      // O callback roda sob o lock interno do auth. Avaliar o AAL no próximo
      // macrotask evita deadlock ao chamar novamente métodos de auth.
      setTimeout(() => {
        void evaluateSession(session, evaluationId)
      }, 0)
    })
  }

  return {
  user: null,
  profile: null,
  isLoading: true,
  isAuthenticated: false,
  mfaRequired: false,
  authError: null,
  pendingMfaFactorId: null,
  teamProfiles: [],
  viewingAs: null,
  viewAll: false,
  visibleIds: null,
  editableIds: null,

  initialize: async () => {
    if (initializationPromise) return initializationPromise

    initializationPromise = (async () => {
      registerAuthListener()
      // Rede de segurança: a tela de "Carregando" nunca pode travar. Se o
      // getSession pendurar (ex: refresh de token lento no self-hosted), libera em 6s.
      const safety = setTimeout(() => set({ isLoading: false }), 6000)
      try {
        const {
          data: { session },
          error,
        } = await supabase.auth.getSession()

        if (error) {
          set({ authError: translateAuthError(error.message) })
        } else if (session?.user) {
          await evaluateSession(session)
        }
      } catch (error) {
        // Sessão inválida ou erro de rede — usuário não autenticado
        set({
          authError: translateAuthError(error instanceof Error ? error.message : String(error)),
        })
      } finally {
        clearTimeout(safety)
        set({ isLoading: false })
      }
    })()

    return initializationPromise
  },

  signIn: async (email, password) => {
    ++authEvaluationGeneration
    // Estamos encerrando o estado anterior, mas uma nova sessão será criada logo
    // abaixo. Mantém o bootstrap do Ops habilitado independentemente da ordem dos
    // listeners SIGNED_IN registrados no Supabase.
    cleanupSessionState(true)

    try {
      const { data, error } = await supabase.auth.signInWithPassword({ email, password })

      if (error) {
        return { error: translateAuthError(error.message), mfaRequired: false }
      }

      if (!data.session || !data.user) {
        return { error: 'Não foi possível iniciar a sessão. Tente novamente.', mfaRequired: false }
      }

      const gate = await evaluateSession(data.session)
      return { error: gate.error, mfaRequired: gate.mfaRequired }
    } catch (error) {
      return {
        error: translateAuthError(error instanceof Error ? error.message : String(error)),
        mfaRequired: false,
      }
    }
  },

  verifyMfa: async (code) => {
    if (!/^\d{6}$/.test(code)) {
      return { error: 'Digite os 6 dígitos do aplicativo autenticador.' }
    }

    const factorId = get().pendingMfaFactorId
    if (!factorId) {
      return { error: 'Nenhum autenticador TOTP verificado foi encontrado para esta conta.' }
    }

    try {
      const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId, code })
      if (error) return { error: translateMfaError(error.message) }

      const { data, error: sessionError } = await supabase.auth.getSession()
      if (sessionError || !data.session) {
        return { error: 'Não foi possível confirmar a nova sessão. Entre novamente.' }
      }

      const gate = await evaluateSession(data.session)
      if (!gate.authenticated) {
        return {
          error: gate.error ?? 'O segundo fator foi confirmado, mas a sessão não atingiu o nível de segurança exigido.',
        }
      }
      return { error: null }
    } catch (error) {
      return { error: translateMfaError(error instanceof Error ? error.message : String(error)) }
    }
  },

  cancelMfa: async () => {
    await get().signOut()
  },

  signOut: async () => {
    ++authEvaluationGeneration
    cleanupSessionState()
    try {
      await supabase.auth.signOut()
    } catch {
      // ignora erros — força logout mesmo assim
    } finally {
      cleanupSessionState()
    }
  },

  loadProfile: async (userId) => {
    const generation = authEvaluationGeneration
    if (get().user?.id !== userId) return
    const { data } = await supabase.from('profiles').select('*').eq('id', userId).single()

    if (
      data
      && generation === authEvaluationGeneration
      && get().user?.id === userId
    ) {
      set({ profile: data as Profile })
    }
  },

  loadTeamProfiles: async () => {
    const generation = authEvaluationGeneration
    const userId = get().user?.id
    if (!userId) return
    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .order('name', { ascending: true })
    if (error) {
      console.error('[auth] loadTeamProfiles:', error.message)
      return
    }
    if (generation !== authEvaluationGeneration || get().user?.id !== userId) return
    set({ teamProfiles: (data ?? []) as Profile[] })
  },

  /**
   * Impersonação (front-first): passa a visualizar as notas/tasks de outra conta.
   * Reseta o estado e recarrega os dados do usuário efetivo. O retorno real de
   * dados depende da policy de RLS no Supabase (back) — hoje cada usuário só lê
   * as próprias notas, então pode vir vazio até liberarmos no banco.
   */
  setViewingAs: async (profile) => {
    // Sobe rascunhos pendentes ANTES de trocar de conta — senão a edição ainda
    // não sincronizada (que vive só no rascunho local) some ao resetar e recarregar.
    await useNotesStore.getState().flushPendingDrafts()
    bumpViewGeneration() // invalida loaders em voo da conta anterior
    set({ viewingAs: profile, viewAll: false })
    useNotesStore.setState({ notes: [], openTabs: [], activeTabId: null, hasLoadedOnce: false })
    useOpsStore.setState({ tasks: [], sections: [] })
    // Carrega os shares do usuário EFETIVO (viewingAs) ANTES do snapshot — senão as
    // categorias compartilhadas COM a conta visualizada não entram na visão impersonada.
    await useSharingStore.getState().loadShares()
    await Promise.all([
      useNotesStore.getState().loadNotes(),
      useOpsStore.getState().refreshOpsSnapshot('view-switch'),
    ])
  },

  /**
   * Modo "Todos" (espelha o Mileto Ops): visão geral de TODA a equipe, agregada
   * por categoria. É só leitura — não cria/edita/exclui (a RLS deixa o DONO/gestão
   * LER tudo, mas editar nota de terceiro exigiria outra permissão). Sai da
   * impersonação ao entrar.
   */
  setViewAll: async (on) => {
    await useNotesStore.getState().flushPendingDrafts()
    bumpViewGeneration() // invalida loaders em voo da visão anterior
    set({ viewAll: on, viewingAs: null })
    useNotesStore.setState({ notes: [], openTabs: [], activeTabId: null, hasLoadedOnce: false })
    useOpsStore.setState({ tasks: [], sections: [] })
    // Recarrega os shares no contexto atual (evita mapa obsoleto de uma impersonação
    // anterior vazar ao voltar pra própria conta). Inerte no "Todos" (includeShared=false).
    await useSharingStore.getState().loadShares()
    await Promise.all([
      useNotesStore.getState().loadNotes(),
      useOpsStore.getState().refreshOpsSnapshot('view-all-toggle'),
    ])
  },

  getEffectiveUserId: () => get().viewingAs?.id ?? get().user?.id,

  // DONO tem controle total: edita/conclui tarefas de qualquer usuário (perfil,
  // "Todos" ou compartilhada). A RLS já permite (notes_update_nucleo dá ao DONO
  // todos os criadores; tasks "Enable update for hierarchy" libera DONO). Os gates
  // de viewAll/shared no front passam a exemptar o DONO via este helper.
  isDono: () => get().profile?.role === 'DONO',

  canDeleteNote: (note) => {
    const realId = get().user?.id
    if (!realId) return false
    if (note.creator_id === realId) return true          // minha nota
    if (get().profile?.role === 'DONO') return true        // DONO apaga de todos
    // Categoria compartilhada (espaço colaborativo): quem PODE EDITAR pode excluir —
    // dono da categoria e destinatário com EDIT (mesma regra de canEditNote). O RPC
    // notas_delete_note_for valida no banco (user_can_edit_note). ⚠️ apagar a nota-raiz
    // apaga a task = tira o card do board do Ops.
    if (note.is_shared_with_me && note.shared_permission === 'EDIT') return true
    const ed = get().editableIds
    return ed != null && ed.has(note.creator_id)           // cargo com EDITAR
  },

  canEditNote: (note) => {
    const realId = get().user?.id
    if (!realId) return false
    if (note.creator_id === realId) return true                          // minha nota
    if (get().profile?.role === 'DONO') return true                       // DONO edita de todos
    if (note.is_shared_with_me && note.shared_permission === 'EDIT') return true
    const ed = get().editableIds
    return ed != null && ed.has(note.creator_id)                          // cargo com EDITAR
  },

  isCategoryOwner: (sectionFullKey) => {
    if (get().profile?.role === 'DONO') return true
    const user = get().user
    if (!user) return false
    return sectionFullKey.startsWith('USR_' + user.id.replace(/-/g, '') + '_')
  },

  /**
   * Carrega os conjuntos de criadores que o usuário REAL pode VER / EDITAR, lidos
   * do permission_settings via RPCs SECURITY DEFINER (mesma regra do Ops: cargo_
   * visibility = ver, cargo_edit = editar, DONO = todos). Usado pelo seletor de
   * contas (quem dá pra "entrar") e pelo editor (entra só lendo vs editando).
   */
  loadPermissionSets: async () => {
    const generation = authEvaluationGeneration
    const userId = get().user?.id
    if (!userId) return
    const toSet = (data: unknown, key: string): Set<string> => {
      if (!Array.isArray(data)) return new Set()
      const ids = (data as unknown[])
        .map((r) => (typeof r === 'string' ? r : (r as Record<string, string | undefined>)[key]))
        .filter((x): x is string => !!x)
      return new Set(ids)
    }
    try {
      const [vis, edit] = await Promise.all([
        supabase.rpc('notas_visible_creator_ids'),
        supabase.rpc('notas_editable_creator_ids'),
      ])
      if (generation !== authEvaluationGeneration || get().user?.id !== userId) return
      set({
        visibleIds: toSet(vis.data, 'notas_visible_creator_ids'),
        editableIds: toSet(edit.data, 'notas_editable_creator_ids'),
      })
    } catch (e) {
      console.warn('[auth] loadPermissionSets:', e)
    }
  },
  }
})
