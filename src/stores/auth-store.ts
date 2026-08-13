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
  /** Conta interna AAL1 ainda sem TOTP verificado; precisa cadastrar um antes de entrar. */
  mfaSetupRequired: boolean
  /** Erro de segurança da sessão que precisa aparecer mesmo fora de um submit. */
  authError: string | null
  /** Fator selecionado para o desafio. Mantido no store para não ir para a UI. */
  pendingMfaFactorId: string | null
  /** Segredo efêmero do cadastro TOTP. Nunca é persistido nem enviado a logs. */
  mfaEnrollment: { qrCode: string; secret: string } | null
  /** Todos os perfis da equipe (para o seletor de contas). */
  teamProfiles: Profile[]
  /** Conta que está sendo visualizada (impersonação). null = a própria conta. */
  viewingAs: Profile | null
  /** Modo "Todos": agrega as notas de TODA a equipe (visão geral, só leitura). */
  viewAll: boolean
  initialize: () => Promise<void>
  signIn: (email: string, password: string) => Promise<{ error: string | null; mfaRequired: boolean }>
  startMfaEnrollment: () => Promise<{ error: string | null }>
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
  let mfaEnrollmentPromise: Promise<{ error: string | null }> | null = null
  let mfaVerificationGeneration = 0
  let mfaVerificationAttempt: {
    id: number
    userId: string
    factorId: string
  } | null = null
  let sessionCleanupInProgress = false

  type SessionGateResult = {
    authenticated: boolean
    mfaRequired: boolean
    mfaSetupRequired: boolean
    error: string | null
  }

  type PrincipalType = 'staff' | 'platform' | 'client'

  const principalType = (session: Session): PrincipalType | null => {
    const principal = session.user.app_metadata?.principal_type
    return principal === 'staff' || principal === 'platform' || principal === 'client'
      ? principal
      : null
  }

  const isInternalPrincipal = (session: Session): boolean => {
    const principal = principalType(session)
    return principal === 'staff' || principal === 'platform'
  }

  /** Limpeza local síncrona e idempotente; não chama nenhum método de auth. */
  const cleanupSessionState = (allowOpsSessionBootstrap = false) => {
    ++mfaVerificationGeneration
    bumpViewGeneration()
    set({
      user: null,
      profile: null,
      isAuthenticated: false,
      mfaRequired: false,
      mfaSetupRequired: false,
      authError: null,
      pendingMfaFactorId: null,
      mfaEnrollment: null,
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
    mfaEnrollmentPromise = null
    mfaVerificationAttempt = null
  }

  const loadProfileForGate = async (
    userId: string,
    evaluationId: number,
  ): Promise<{ profile: Profile | null; stale: boolean; error: string | null }> => {
    const { data, error } = await supabase.from('profiles').select('*').eq('id', userId).single()
    const stale = evaluationId !== authEvaluationGeneration || get().user?.id !== userId
    if (stale) return { profile: null, stale: true, error: null }
    if (error) console.error('[auth] loadProfile:', error.message)
    return {
      profile: data ? data as Profile : null,
      stale: false,
      error: error ? 'Não foi possível validar o perfil desta conta. Tente entrar novamente.' : null,
    }
  }

  const publishAuthenticatedSession = async (
    session: Session,
    evaluationId: number,
  ): Promise<boolean> => {
    const loaded = await loadProfileForGate(session.user.id, evaluationId)
    if (loaded.stale) return false
    if (loaded.error || !loaded.profile) {
      set({
        user: session.user,
        profile: null,
        isAuthenticated: false,
        mfaRequired: false,
        mfaSetupRequired: false,
        pendingMfaFactorId: null,
        mfaEnrollment: null,
        authError: loaded.error ?? 'Esta conta não possui um perfil interno válido.',
      })
      return false
    }
    set({
      user: session.user,
      profile: loaded.profile,
      isAuthenticated: true,
      mfaRequired: false,
      mfaSetupRequired: false,
      pendingMfaFactorId: null,
      mfaEnrollment: null,
      authError: null,
    })
    return true
  }

  /**
   * Decide se uma sessão pode abrir o app. Staff/platform sempre exige AAL2,
   * inclusive quando ainda não existe fator (nesse caso abre o cadastro TOTP).
   */
  const evaluateSession = async (
    session: Session,
    evaluationId = ++authEvaluationGeneration,
  ): Promise<SessionGateResult> => {
    const currentGate = (): SessionGateResult => ({
      authenticated: get().isAuthenticated,
      mfaRequired: get().mfaRequired,
      mfaSetupRequired: get().mfaSetupRequired,
      error: null,
    })

    try {
      if (evaluationId !== authEvaluationGeneration) {
        return currentGate()
      }
      if (get().user?.id !== session.user.id) {
        set({
          user: session.user,
          profile: null,
          isAuthenticated: false,
          mfaRequired: false,
          mfaSetupRequired: false,
          pendingMfaFactorId: null,
          mfaEnrollment: null,
        })
      }

      // A classificação vem de app_metadata assinada pelo servidor. user_metadata
      // é editável pelo cliente e nunca pode decidir acesso ao aplicativo interno.
      const principal = principalType(session)
      if (!principal || principal === 'client') {
        const message = principal === 'client'
          ? 'Esta conta de cliente deve acessar o Portal Mileto Ops; o Notas é exclusivo da equipe interna.'
          : 'Esta conta não possui uma classificação de acesso confiável.'
        set({
          user: session.user,
          profile: null,
          isAuthenticated: false,
          mfaRequired: false,
          mfaSetupRequired: false,
          pendingMfaFactorId: null,
          mfaEnrollment: null,
          authError: message,
        })
        return {
          authenticated: false,
          mfaRequired: false,
          mfaSetupRequired: false,
          error: message,
        }
      }

      const { data: assurance, error: assuranceError } =
        await supabase.auth.mfa.getAuthenticatorAssuranceLevel()

      if (evaluationId !== authEvaluationGeneration) {
        return currentGate()
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
          mfaSetupRequired: false,
          pendingMfaFactorId: null,
          mfaEnrollment: null,
          authError: message,
        })
        return { authenticated: false, mfaRequired: false, mfaSetupRequired: false, error: message }
      }

      // Uma sessão que já possui AAL2 não deve pedir o código novamente.
      if (assurance.currentLevel === 'aal2') {
        const authenticated = await publishAuthenticatedSession(session, evaluationId)
        return {
          authenticated,
          mfaRequired: false,
          mfaSetupRequired: false,
          error: authenticated ? null : get().authError,
        }
      }

      // AAL1 nunca atravessa o gate interno. A lista de fatores decide entre
      // desafiar um autenticador existente e cadastrar o primeiro.
      const { data: factors, error: factorsError } = await supabase.auth.mfa.listFactors()
      if (evaluationId !== authEvaluationGeneration) return currentGate()

      if (factorsError || !factors) {
        const message = factorsError
          ? translateMfaError(factorsError.message)
          : 'Não foi possível consultar o autenticador desta conta.'
        set({
          user: session.user,
          profile: null,
          isAuthenticated: false,
          mfaRequired: false,
          mfaSetupRequired: false,
          pendingMfaFactorId: null,
          mfaEnrollment: null,
          authError: message,
        })
        return { authenticated: false, mfaRequired: false, mfaSetupRequired: false, error: message }
      }

      const verifiedFactor = factors.totp
        .filter((factor) => factor.status === 'verified')
        .sort((a, b) => Date.parse(b.updated_at) - Date.parse(a.updated_at))[0]

      if (verifiedFactor) {
        set({
          user: session.user,
          profile: null,
          isAuthenticated: false,
          mfaRequired: true,
          mfaSetupRequired: false,
          pendingMfaFactorId: verifiedFactor.id,
          mfaEnrollment: null,
          authError: null,
        })
        return { authenticated: false, mfaRequired: true, mfaSetupRequired: false, error: null }
      }

      set({
        user: session.user,
        profile: null,
        isAuthenticated: false,
        mfaRequired: false,
        mfaSetupRequired: true,
        pendingMfaFactorId: null,
        mfaEnrollment: null,
        authError: null,
      })
      return { authenticated: false, mfaRequired: false, mfaSetupRequired: true, error: null }
    } catch (error) {
      if (evaluationId !== authEvaluationGeneration) {
        return currentGate()
      }
      const message = translateMfaError(error instanceof Error ? error.message : String(error))
      set({
        user: session.user,
        profile: null,
        isAuthenticated: false,
        mfaRequired: false,
        mfaSetupRequired: false,
        pendingMfaFactorId: null,
        mfaEnrollment: null,
        authError: message,
      })
      return { authenticated: false, mfaRequired: false, mfaSetupRequired: false, error: message }
    }
  }

  const registerAuthListener = () => {
    if (authListenerRegistered) return
    authListenerRegistered = true

    supabase.auth.onAuthStateChange((event, session) => {
      const activeVerification = mfaVerificationAttempt
      if (
        event === 'MFA_CHALLENGE_VERIFIED' &&
        activeVerification &&
        session?.user.id === activeVerification.userId &&
        get().pendingMfaFactorId === activeVerification.factorId
      ) {
        // verifyMfa revalida a resposta e publica a sessão AAL2. Evita uma segunda
        // avaliação concorrente limpar o factorId antes dessas verificações.
        return
      }

      const evaluationId = ++authEvaluationGeneration

      if (event === 'SIGNED_OUT' || !session) {
        cleanupSessionState()
        return
      }

      // Ignora TOKEN_REFRESHED/MFA_CHALLENGE_VERIFIED tardios enquanto um logout
      // explícito remove o fator incompleto e encerra a sessão no servidor.
      if (sessionCleanupInProgress) return

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
  mfaSetupRequired: false,
  authError: null,
  pendingMfaFactorId: null,
  mfaEnrollment: null,
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
      return { error: gate.error, mfaRequired: gate.mfaRequired || gate.mfaSetupRequired }
    } catch (error) {
      return {
        error: translateAuthError(error instanceof Error ? error.message : String(error)),
        mfaRequired: false,
      }
    }
  },

  startMfaEnrollment: async () => {
    if (mfaEnrollmentPromise) return mfaEnrollmentPromise

    const generation = authEvaluationGeneration
    const userId = get().user?.id
    if (!userId || !get().mfaSetupRequired || get().isAuthenticated) {
      return { error: 'A sessão de cadastro do autenticador não está mais ativa. Entre novamente.' }
    }

    const attempt = (async (): Promise<{ error: string | null }> => {
      const isCurrent = () => (
        generation === authEvaluationGeneration &&
        get().user?.id === userId &&
        get().mfaSetupRequired &&
        !get().isAuthenticated
      )

      try {
        const { data: sessionData, error: sessionError } = await supabase.auth.getSession()
        const session = sessionData.session
        if (sessionError || !session || session.user.id !== userId || !isInternalPrincipal(session)) {
          return { error: 'A sessão mudou durante o cadastro. Entre novamente.' }
        }
        if (!isCurrent()) return { error: 'A sessão mudou durante o cadastro. Tente novamente.' }

        const { data: factors, error: factorsError } = await supabase.auth.mfa.listFactors()
        if (!isCurrent()) return { error: 'A sessão mudou durante o cadastro. Tente novamente.' }
        if (factorsError || !factors) {
          return { error: 'Não foi possível consultar o autenticador. Tente novamente.' }
        }

        // Outro cliente pode ter concluído o cadastro enquanto esta tela estava
        // aberta. Nesse caso muda para desafio sem criar um fator duplicado.
        const verified = factors.totp
          .filter((factor) => factor.status === 'verified')
          .sort((a, b) => Date.parse(b.updated_at) - Date.parse(a.updated_at))[0]
        if (verified) {
          set({
            mfaRequired: true,
            mfaSetupRequired: false,
            pendingMfaFactorId: verified.id,
            mfaEnrollment: null,
            authError: null,
          })
          return { error: null }
        }

        // Não remove fatores incompletos de outras telas/dispositivos: isso faria
        // duas configurações simultâneas se apagarem. O nome único também permite
        // recuperar com segurança de um cadastro abandonado cujo QR é irrecuperável.
        const { data: enrolled, error: enrollError } = await supabase.auth.mfa.enroll({
          factorType: 'totp',
          friendlyName: `Mileto Notas ${window.crypto.randomUUID().slice(0, 8)}`,
          issuer: 'Mileto Ops',
        })
        if (!isCurrent()) return { error: 'A sessão mudou durante o cadastro. Tente novamente.' }
        if (enrollError || !enrolled) {
          return { error: 'Não foi possível gerar o QR Code. Tente novamente.' }
        }

        // QR e segredo existem somente em memória durante esta etapa.
        set({
          pendingMfaFactorId: enrolled.id,
          mfaEnrollment: {
            qrCode: enrolled.totp.qr_code,
            secret: enrolled.totp.secret,
          },
          authError: null,
        })
        return { error: null }
      } catch {
        return { error: 'Não foi possível iniciar o cadastro do autenticador. Tente novamente.' }
      }
    })()

    mfaEnrollmentPromise = attempt
    try {
      return await attempt
    } finally {
      if (mfaEnrollmentPromise === attempt) mfaEnrollmentPromise = null
    }
  },

  verifyMfa: async (code) => {
    if (!/^\d{6}$/.test(code)) {
      return { error: 'Digite os 6 dígitos do aplicativo autenticador.' }
    }

    const factorId = get().pendingMfaFactorId
    const userId = get().user?.id
    if (!factorId) {
      return { error: 'Nenhum autenticador TOTP ativo foi encontrado para esta conta.' }
    }
    if (!userId || get().isAuthenticated) return { error: 'A sessão de verificação expirou. Entre novamente.' }

    // Separado de authEvaluationGeneration: o sucesso do próprio desafio emite
    // MFA_CHALLENGE_VERIFIED e legitimamente inicia outra avaliação de sessão.
    // Cancelar, sair ou trocar de conta invalida este id em cleanupSessionState.
    const verificationId = ++mfaVerificationGeneration
    const verificationAttempt = { id: verificationId, userId, factorId }
    mfaVerificationAttempt = verificationAttempt
    const isCurrentIdentity = () => (
      verificationId === mfaVerificationGeneration && get().user?.id === userId
    )
    const isCurrentAttempt = () => (
      isCurrentIdentity() &&
      mfaVerificationAttempt === verificationAttempt &&
      get().pendingMfaFactorId === factorId
    )

    try {
      const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId, code })
      if (!isCurrentAttempt()) {
        return { error: 'A sessão mudou durante a verificação. Entre novamente.' }
      }
      if (error) return { error: translateMfaError(error.message) }

      // O fator acabou de ser verificado; o segredo não deve permanecer na UI
      // enquanto confirmamos o JWT AAL2 retornado pelo Auth.
      set({ mfaEnrollment: null })

      const { data, error: sessionError } = await supabase.auth.getSession()
      if (
        !isCurrentAttempt() ||
        sessionError ||
        !data.session ||
        data.session.user.id !== userId
      ) {
        return { error: 'Não foi possível confirmar a nova sessão. Entre novamente.' }
      }

      const gate = await evaluateSession(data.session)
      if (!isCurrentIdentity()) {
        return { error: 'A sessão mudou durante a verificação. Entre novamente.' }
      }
      if (!gate.authenticated || !get().isAuthenticated || get().user?.id !== userId) {
        return {
          error: gate.error ?? 'O segundo fator foi confirmado, mas a sessão não atingiu o nível de segurança exigido.',
        }
      }
      return { error: null }
    } catch (error) {
      return { error: translateMfaError(error instanceof Error ? error.message : String(error)) }
    } finally {
      if (mfaVerificationAttempt === verificationAttempt) mfaVerificationAttempt = null
    }
  },

  cancelMfa: async () => {
    await get().signOut()
  },

  signOut: async () => {
    // Se o usuário sair no meio do cadastro, tenta remover apenas o fator ainda
    // não verificado. Fator verificado usado no desafio nunca é removido aqui.
    const pendingEnrollmentFactorId = get().mfaEnrollment ? get().pendingMfaFactorId : null
    sessionCleanupInProgress = true
    ++authEvaluationGeneration
    cleanupSessionState()
    try {
      if (pendingEnrollmentFactorId) {
        await Promise.race([
          supabase.auth.mfa.unenroll({ factorId: pendingEnrollmentFactorId }),
          new Promise<void>((resolve) => setTimeout(resolve, 3000)),
        ])
      }
      await supabase.auth.signOut()
    } catch {
      // Se a remoção falhar, o fator continua inofensivo e não verificado.
      // A limpeza local e o logout continuam mesmo com erro de rede.
      try {
        await supabase.auth.signOut()
      } catch {
        // ignora erros — força logout local mesmo assim
      }
    } finally {
      cleanupSessionState()
      sessionCleanupInProgress = false
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
