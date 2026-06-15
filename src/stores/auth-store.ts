import { create } from 'zustand'
import type { User } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'
import { useCollaboratorsStore } from './collaborators-store'
import { useNotesStore, clearNotesAuthCache } from './notes-store'
import { useOpsStore, clearOpsAuthCache } from './ops-store'
import type { Note, Profile } from '../lib/types'

interface AuthState {
  user: User | null
  profile: Profile | null
  isLoading: boolean
  isAuthenticated: boolean
  /** Todos os perfis da equipe (para o seletor de contas). */
  teamProfiles: Profile[]
  /** Conta que está sendo visualizada (impersonação). null = a própria conta. */
  viewingAs: Profile | null
  /** Modo "Todos": agrega as notas de TODA a equipe (visão geral, só leitura). */
  viewAll: boolean
  initialize: () => Promise<void>
  signIn: (email: string, password: string) => Promise<{ error: string | null }>
  signOut: () => Promise<void>
  loadProfile: (userId: string) => Promise<void>
  loadTeamProfiles: () => Promise<void>
  setViewingAs: (profile: Profile | null) => Promise<void>
  /** Entra/sai do modo "Todos" (visão geral de toda a equipe — leitura). */
  setViewAll: (on: boolean) => Promise<void>
  /** ID do usuário cujas notas/tasks devem ser carregadas (impersonação ou próprio). */
  getEffectiveUserId: () => string | undefined
  /**
   * True se o usuário REAL é o dono da nota (pode excluir). Nunca usa viewingAs —
   * exclusão é prerrogativa do dono real, não da conta visualizada.
   */
  canDeleteNote: (note: Note) => boolean
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

export const useAuthStore = create<AuthState>()((set, get) => ({
  user: null,
  profile: null,
  isLoading: true,
  isAuthenticated: false,
  teamProfiles: [],
  viewingAs: null,
  viewAll: false,
  visibleIds: null,
  editableIds: null,

  initialize: async () => {
    // Rede de segurança: a tela de "Carregando" nunca pode travar. Se o
    // getSession pendurar (ex: refresh de token lento no self-hosted), libera em 6s.
    const safety = setTimeout(() => set({ isLoading: false }), 6000)
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession()

      if (session?.user) {
        set({ user: session.user, isAuthenticated: true })
        // NÃO bloqueia a abertura do app — o perfil carrega em background.
        void get().loadProfile(session.user.id)
      }
    } catch {
      // Sessão inválida ou erro de rede — usuário não autenticado
    } finally {
      clearTimeout(safety)
      set({ isLoading: false })
    }

    // Escutar mudanças de sessão (token expirado, logout em outra aba, etc)
    supabase.auth.onAuthStateChange(async (event, session) => {
      if (event === 'SIGNED_OUT' || !session) {
        set({ user: null, profile: null, isAuthenticated: false })
      } else if (session.user) {
        set({ user: session.user, isAuthenticated: true })
        void get().loadProfile(session.user.id)
      }
    })
  },

  signIn: async (email, password) => {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password })

    if (error) {
      return { error: translateAuthError(error.message) }
    }

    if (data.user) {
      set({ user: data.user, isAuthenticated: true })
      await get().loadProfile(data.user.id)
    }

    return { error: null }
  },

  signOut: async () => {
    try {
      await supabase.auth.signOut()
    } catch {
      // ignora erros — força logout mesmo assim
    } finally {
      set({ user: null, profile: null, isAuthenticated: false, viewingAs: null, viewAll: false, teamProfiles: [], visibleIds: null, editableIds: null })
      useCollaboratorsStore.getState().resetStore()

      // Limpa tokens em cache + estado dos demais stores e encerra os canais
      // realtime. Assim, "sair e entrar de novo" re-autentica de verdade contra
      // o Supabase — a senha atual do Mileto Ops passa a valer e a antiga deixa
      // de funcionar (não há sessão/token velho sendo reaproveitado).
      clearNotesAuthCache()
      clearOpsAuthCache()
      useNotesStore.getState().unsubscribeFromNote()
      useOpsStore.getState().unsubscribeFromOpsChanges()
      useNotesStore.setState({
        notes: [],
        openTabs: [],
        activeTabId: null,
        hasLoadedOnce: false,
        pendingSync: 0,
        noteIdsWithCollaborators: new Set(),
      })
      useOpsStore.setState({ sections: [], tasks: [], activeSectionId: null })
    }
  },

  loadProfile: async (userId) => {
    const { data } = await supabase.from('profiles').select('*').eq('id', userId).single()

    if (data) {
      set({ profile: data as Profile })
    }
  },

  loadTeamProfiles: async () => {
    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .order('name', { ascending: true })
    if (error) {
      console.error('[auth] loadTeamProfiles:', error.message)
      return
    }
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
    set({ viewingAs: profile, viewAll: false })
    useNotesStore.setState({ notes: [], openTabs: [], activeTabId: null, hasLoadedOnce: false })
    useOpsStore.setState({ tasks: [], sections: [] })
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
    set({ viewAll: on, viewingAs: null })
    useNotesStore.setState({ notes: [], openTabs: [], activeTabId: null, hasLoadedOnce: false })
    useOpsStore.setState({ tasks: [], sections: [] })
    await Promise.all([
      useNotesStore.getState().loadNotes(),
      useOpsStore.getState().refreshOpsSnapshot('view-all-toggle'),
    ])
  },

  getEffectiveUserId: () => get().viewingAs?.id ?? get().user?.id,

  canDeleteNote: (note) => note.creator_id === get().user?.id,

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
      set({
        visibleIds: toSet(vis.data, 'notas_visible_creator_ids'),
        editableIds: toSet(edit.data, 'notas_editable_creator_ids'),
      })
    } catch (e) {
      console.warn('[auth] loadPermissionSets:', e)
    }
  },
}))
