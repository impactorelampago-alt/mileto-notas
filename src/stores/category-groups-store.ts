import { create } from 'zustand'
import { supabase } from '../lib/supabase'
import { useAuthStore } from './auth-store'

export interface CategoryGroup {
  id: string
  account_id: string
  user_id: string
  name: string
  position: number
  collapsed: boolean
  created_at: string
  updated_at: string
}

export interface CategoryGroupItem {
  account_id: string
  user_id: string
  category_key: string
  group_id: string | null
  position: number
  created_at: string
  updated_at: string
}

interface CategoryGroupsState {
  groups: CategoryGroup[]
  items: CategoryGroupItem[]
  isLoading: boolean
  error: string | null
  /** Identidade efetiva à qual o snapshot atual pertence. */
  loadedUserId: string | null
  /** Somente no dev: identidade usando a prévia local porque as tabelas ainda não existem. */
  localPreviewUserId: string | null
  loadGroups: () => Promise<void>
  createGroup: (name: string) => Promise<CategoryGroup | null>
  renameGroup: (groupId: string, name: string) => Promise<boolean>
  deleteGroup: (groupId: string) => Promise<boolean>
  toggleGroup: (groupId: string) => Promise<boolean>
  /** `null` remove do grupo e mantém uma posição pessoal na área sem grupo. */
  assignCategory: (categoryKey: string, groupId: string | null) => Promise<boolean>
  reorderGroups: (orderedGroupIds: string[]) => Promise<boolean>
  reorderCategories: (groupId: string | null, orderedCategoryKeys: string[]) => Promise<boolean>
  clear: () => void
}

let loadGeneration = 0

interface LocalPreviewSnapshot {
  groups: CategoryGroup[]
  items: CategoryGroupItem[]
}

const LOCAL_PREVIEW_STORAGE_PREFIX = 'mileto-notas.category-groups-preview.v1'
const LOCAL_PREVIEW_ACCOUNT_ID = '00000000-0000-0000-0000-000000000000'

function isMissingGroupsSchema(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false
  if (error.code === 'PGRST205' || error.code === '42P01') return true
  const message = (error.message ?? '').toLowerCase()
  return message.includes('schema cache')
    && (
      message.includes('notas_category_groups')
      || message.includes('notas_category_group_items')
    )
}

function localPreviewStorageKey(userId: string): string {
  return `${LOCAL_PREVIEW_STORAGE_PREFIX}:${userId}`
}

function readLocalPreview(userId: string): LocalPreviewSnapshot {
  try {
    const raw = window.localStorage.getItem(localPreviewStorageKey(userId))
    if (!raw) return { groups: [], items: [] }
    const parsed = JSON.parse(raw) as Partial<LocalPreviewSnapshot>
    return {
      groups: (Array.isArray(parsed.groups) ? parsed.groups : [])
        .filter((group) => group?.user_id === userId),
      items: (Array.isArray(parsed.items) ? parsed.items : [])
        .filter((item) => item?.user_id === userId),
    }
  } catch (error) {
    console.warn('[category-groups] prévia local inválida:', error)
    return { groups: [], items: [] }
  }
}

function writeLocalPreview(
  userId: string,
  groups: CategoryGroup[],
  items: CategoryGroupItem[],
): void {
  try {
    window.localStorage.setItem(
      localPreviewStorageKey(userId),
      JSON.stringify({ groups, items } satisfies LocalPreviewSnapshot),
    )
  } catch (error) {
    console.warn('[category-groups] não foi possível salvar a prévia local:', error)
  }
}

function localPreviewAccountId(): string {
  const profile = useAuthStore.getState().profile as ({ account_id?: string } | null)
  return profile?.account_id ?? LOCAL_PREVIEW_ACCOUNT_ID
}

function sameGroupName(left: string, right: string): boolean {
  return left.trim().toLocaleLowerCase('pt-BR') === right.trim().toLocaleLowerCase('pt-BR')
}

function mutationUserId(): string | null {
  const auth = useAuthStore.getState()
  if (!auth.user || auth.viewAll || auth.viewingAs) return null

  const effectiveId = auth.getEffectiveUserId()
  // Defesa adicional para não gravar preferências na identidade errada se uma
  // troca de visualização ocorrer entre o clique e o início da mutation.
  return effectiveId === auth.user.id ? effectiveId : null
}

function mutationBlockedMessage(): string {
  return 'Os grupos só podem ser alterados na sua própria conta.'
}

function normalizeName(name: string): string | null {
  const normalized = name.trim().replace(/\s+/g, ' ')
  if (!normalized || normalized.length > 80) return null
  return normalized
}

function normalizeCategoryKey(categoryKey: string): string | null {
  const normalized = categoryKey.trim()
  if (!normalized) return null
  return normalized
}

function nextPosition(values: number[]): number {
  return values.length === 0 ? 0 : Math.max(...values) + 1
}

function mergeOrder<T>(
  current: T[],
  requestedIds: string[],
  idOf: (value: T) => string,
): T[] {
  const byId = new Map(current.map((value) => [idOf(value), value]))
  const seen = new Set<string>()
  const ordered: T[] = []

  for (const id of requestedIds) {
    const value = byId.get(id)
    if (!value || seen.has(id)) continue
    seen.add(id)
    ordered.push(value)
  }
  for (const value of current) {
    const id = idOf(value)
    if (!seen.has(id)) ordered.push(value)
  }
  return ordered
}

export const useCategoryGroupsStore = create<CategoryGroupsState>()((set, get) => ({
  groups: [],
  items: [],
  isLoading: false,
  error: null,
  loadedUserId: null,
  localPreviewUserId: null,

  loadGroups: async () => {
    const userId = useAuthStore.getState().getEffectiveUserId()
    const generation = ++loadGeneration

    if (!userId) {
      set({
        groups: [], items: [], isLoading: false, error: null,
        loadedUserId: null, localPreviewUserId: null,
      })
      return
    }

    // Ao trocar a identidade efetiva, nunca deixe nomes/vínculos da conta
    // anterior aparecerem enquanto o novo snapshot ainda está em trânsito.
    const switchingUser = get().loadedUserId !== userId
    set({
      ...(switchingUser
        ? { groups: [], items: [], loadedUserId: null, localPreviewUserId: null }
        : {}),
      isLoading: true,
      error: null,
    })
    const [groupsResult, itemsResult] = await Promise.all([
      supabase
        .from('notas_category_groups')
        .select('*')
        .eq('user_id', userId)
        .order('position', { ascending: true })
        .order('created_at', { ascending: true }),
      supabase
        .from('notas_category_group_items')
        .select('*')
        .eq('user_id', userId)
        .order('position', { ascending: true })
        .order('created_at', { ascending: true }),
    ])

    // Descarta respostas da conta anterior quando a visualização muda no meio
    // dos requests, igual aos guards dos stores de notas/ops.
    if (
      generation !== loadGeneration
      || useAuthStore.getState().getEffectiveUserId() !== userId
    ) return

    const error = groupsResult.error ?? itemsResult.error
    if (error) {
      const auth = useAuthStore.getState()
      const ownView = !auth.viewAll && !auth.viewingAs && auth.user?.id === userId
      const missingSchema = isMissingGroupsSchema(groupsResult.error)
        || isMissingGroupsSchema(itemsResult.error)

      // A prévia local existe exclusivamente para desenvolver/validar a UI sem
      // tocar no Supabase compartilhado. Nunca mascara rede, RLS ou outro erro.
      if (import.meta.env.DEV && missingSchema) {
        const snapshot = ownView
          ? readLocalPreview(userId)
          : { groups: [], items: [] }
        console.info('[category-groups] tabelas ausentes; usando prévia local de desenvolvimento')
        set({
          groups: snapshot.groups,
          items: snapshot.items,
          isLoading: false,
          error: null,
          loadedUserId: userId,
          localPreviewUserId: ownView ? userId : null,
        })
        return
      }

      console.error('[category-groups] loadGroups:', error.message)
      set({
        groups: [],
        items: [],
        isLoading: false,
        error: missingSchema
          ? 'Os grupos ainda não foram ativados neste servidor.'
          : error.message,
        loadedUserId: userId,
        localPreviewUserId: null,
      })
      return
    }

    set({
      groups: (groupsResult.data ?? []) as CategoryGroup[],
      items: (itemsResult.data ?? []) as CategoryGroupItem[],
      isLoading: false,
      error: null,
      loadedUserId: userId,
      localPreviewUserId: null,
    })
  },

  createGroup: async (rawName) => {
    const userId = mutationUserId()
    if (!userId) {
      set({ error: mutationBlockedMessage() })
      return null
    }
    const name = normalizeName(rawName)
    if (!name) {
      set({ error: 'Informe um nome de grupo entre 1 e 80 caracteres.' })
      return null
    }

    const position = nextPosition(
      get().groups.filter((group) => group.user_id === userId).map((group) => group.position),
    )

    if (get().localPreviewUserId === userId) {
      if (get().groups.some((group) => sameGroupName(group.name, name))) {
        set({ error: 'Já existe um grupo com esse nome.' })
        return null
      }
      const now = new Date().toISOString()
      const group: CategoryGroup = {
        id: crypto.randomUUID(),
        account_id: localPreviewAccountId(),
        user_id: userId,
        name,
        position,
        collapsed: false,
        created_at: now,
        updated_at: now,
      }
      const groups = [...get().groups, group]
      set({ groups, error: null })
      writeLocalPreview(userId, groups, get().items)
      return group
    }

    const { data, error } = await supabase
      .from('notas_category_groups')
      .insert({ user_id: userId, name, position, collapsed: false })
      .select('*')
      .single()

    if (error) {
      console.error('[category-groups] createGroup:', error.message)
      set({ error: error.message })
      return null
    }

    const group = data as CategoryGroup
    // Só incorpora o resultado se a identidade efetiva não mudou durante o save.
    if (useAuthStore.getState().getEffectiveUserId() === userId) {
      set((state) => ({ groups: [...state.groups, group], error: null }))
    }
    return group
  },

  renameGroup: async (groupId, rawName) => {
    const userId = mutationUserId()
    if (!userId) {
      set({ error: mutationBlockedMessage() })
      return false
    }
    const name = normalizeName(rawName)
    if (!name) {
      set({ error: 'Informe um nome de grupo entre 1 e 80 caracteres.' })
      return false
    }

    if (get().localPreviewUserId === userId) {
      const current = get().groups.find((group) => group.id === groupId)
      if (!current) {
        set({ error: 'Grupo não encontrado.' })
        return false
      }
      if (get().groups.some(
        (group) => group.id !== groupId && sameGroupName(group.name, name),
      )) {
        set({ error: 'Já existe um grupo com esse nome.' })
        return false
      }
      const groups = get().groups.map((group) => group.id === groupId
        ? { ...group, name, updated_at: new Date().toISOString() }
        : group)
      set({ groups, error: null })
      writeLocalPreview(userId, groups, get().items)
      return true
    }

    const { data, error } = await supabase
      .from('notas_category_groups')
      .update({ name })
      .eq('id', groupId)
      .eq('user_id', userId)
      .select('*')
      .maybeSingle()

    if (error || !data) {
      const message = error?.message ?? 'Grupo não encontrado.'
      console.error('[category-groups] renameGroup:', message)
      set({ error: message })
      return false
    }

    if (useAuthStore.getState().getEffectiveUserId() === userId) {
      const updated = data as CategoryGroup
      set((state) => ({
        groups: state.groups.map((group) => group.id === groupId ? updated : group),
        error: null,
      }))
    }
    return true
  },

  deleteGroup: async (groupId) => {
    const userId = mutationUserId()
    if (!userId) {
      set({ error: mutationBlockedMessage() })
      return false
    }

    if (get().localPreviewUserId === userId) {
      if (!get().groups.some((group) => group.id === groupId)) {
        set({ error: 'Grupo não encontrado.' })
        return false
      }
      const groups = get().groups.filter((group) => group.id !== groupId)
      const items = get().items.filter((item) => item.group_id !== groupId)
      set({ groups, items, error: null })
      writeLocalPreview(userId, groups, items)
      return true
    }

    const { data, error } = await supabase
      .from('notas_category_groups')
      .delete()
      .eq('id', groupId)
      .eq('user_id', userId)
      .select('id')
      .maybeSingle()

    if (error || !data) {
      const message = error?.message ?? 'Grupo não encontrado.'
      console.error('[category-groups] deleteGroup:', message)
      set({ error: message })
      return false
    }

    if (useAuthStore.getState().getEffectiveUserId() === userId) {
      set((state) => ({
        groups: state.groups.filter((group) => group.id !== groupId),
        // O FK ON DELETE CASCADE remove somente o vínculo. As categorias do Ops
        // continuam existindo e reaparecem na área sem grupo.
        items: state.items.filter((item) => item.group_id !== groupId),
        error: null,
      }))
    }
    return true
  },

  toggleGroup: async (groupId) => {
    const userId = mutationUserId()
    if (!userId) {
      set({ error: mutationBlockedMessage() })
      return false
    }
    const current = get().groups.find(
      (group) => group.id === groupId && group.user_id === userId,
    )
    if (!current) {
      set({ error: 'Grupo não encontrado.' })
      return false
    }

    if (get().localPreviewUserId === userId) {
      const groups = get().groups.map((group) => group.id === groupId
        ? { ...group, collapsed: !group.collapsed, updated_at: new Date().toISOString() }
        : group)
      set({ groups, error: null })
      writeLocalPreview(userId, groups, get().items)
      return true
    }

    const { data, error } = await supabase
      .from('notas_category_groups')
      .update({ collapsed: !current.collapsed })
      .eq('id', groupId)
      .eq('user_id', userId)
      .select('*')
      .maybeSingle()

    if (error || !data) {
      const message = error?.message ?? 'Grupo não encontrado.'
      console.error('[category-groups] toggleGroup:', message)
      set({ error: message })
      return false
    }

    if (useAuthStore.getState().getEffectiveUserId() === userId) {
      const updated = data as CategoryGroup
      set((state) => ({
        groups: state.groups.map((group) => group.id === groupId ? updated : group),
        error: null,
      }))
    }
    return true
  },

  assignCategory: async (rawCategoryKey, groupId) => {
    const userId = mutationUserId()
    if (!userId) {
      set({ error: mutationBlockedMessage() })
      return false
    }
    const categoryKey = normalizeCategoryKey(rawCategoryKey)
    if (!categoryKey) {
      set({ error: 'Categoria inválida.' })
      return false
    }
    if (groupId && !get().groups.some(
      (group) => group.id === groupId && group.user_id === userId,
    )) {
      set({ error: 'Grupo de destino não encontrado.' })
      return false
    }

    const position = nextPosition(
      get().items
        .filter((item) => item.user_id === userId && item.group_id === groupId)
        .map((item) => item.position),
    )

    if (get().localPreviewUserId === userId) {
      const current = get().items.find((item) => item.category_key === categoryKey)
      const now = new Date().toISOString()
      const saved: CategoryGroupItem = {
        account_id: current?.account_id ?? localPreviewAccountId(),
        user_id: userId,
        category_key: categoryKey,
        group_id: groupId,
        position,
        created_at: current?.created_at ?? now,
        updated_at: now,
      }
      const items = [
        ...get().items.filter((item) => item.category_key !== categoryKey),
        saved,
      ]
      set({ items, error: null })
      writeLocalPreview(userId, get().groups, items)
      return true
    }

    const { data, error } = await supabase
      .from('notas_category_group_items')
      .upsert(
        { user_id: userId, category_key: categoryKey, group_id: groupId, position },
        { onConflict: 'account_id,user_id,category_key' },
      )
      .select('*')
      .single()

    if (error) {
      console.error('[category-groups] assignCategory:', error.message)
      set({ error: error.message })
      return false
    }

    if (useAuthStore.getState().getEffectiveUserId() === userId) {
      const saved = data as CategoryGroupItem
      set((state) => ({
        items: [...state.items.filter((item) => item.category_key !== categoryKey), saved],
        error: null,
      }))
    }
    return true
  },

  reorderGroups: async (orderedGroupIds) => {
    const userId = mutationUserId()
    if (!userId) {
      set({ error: mutationBlockedMessage() })
      return false
    }
    const current = get().groups.filter((group) => group.user_id === userId)
    const ordered = mergeOrder(current, orderedGroupIds, (group) => group.id)
    if (ordered.length === 0) return true

    if (get().localPreviewUserId === userId) {
      const now = new Date().toISOString()
      const groups = ordered.map((group, position) => ({
        ...group,
        position,
        updated_at: now,
      }))
      set({ groups, error: null })
      writeLocalPreview(userId, groups, get().items)
      return true
    }

    const rows = ordered.map((group, position) => ({
      id: group.id,
      user_id: userId,
      name: group.name,
      collapsed: group.collapsed,
      position,
    }))
    const { data, error } = await supabase
      .from('notas_category_groups')
      .upsert(rows, { onConflict: 'id' })
      .select('*')

    if (error) {
      console.error('[category-groups] reorderGroups:', error.message)
      set({ error: error.message })
      return false
    }

    if (useAuthStore.getState().getEffectiveUserId() === userId) {
      const savedById = new Map(
        ((data ?? []) as CategoryGroup[]).map((group) => [group.id, group]),
      )
      set({
        groups: ordered.map((group, position) => savedById.get(group.id) ?? { ...group, position }),
        error: null,
      })
    }
    return true
  },

  reorderCategories: async (groupId, orderedCategoryKeys) => {
    const userId = mutationUserId()
    if (!userId) {
      set({ error: mutationBlockedMessage() })
      return false
    }
    if (groupId && !get().groups.some(
      (group) => group.id === groupId && group.user_id === userId,
    )) {
      set({ error: 'Grupo não encontrado.' })
      return false
    }

    const current = get().items.filter(
      (item) => item.user_id === userId && item.group_id === groupId,
    )
    const requested = [...new Set(
      orderedCategoryKeys.map((key) => normalizeCategoryKey(key)).filter((key): key is string => !!key),
    )]
    const currentKeys = new Set(current.map((item) => item.category_key))
    const keys = [...requested, ...current
      .map((item) => item.category_key)
      .filter((key) => !requested.includes(key))]

    if (keys.length === 0) return true

    if (get().localPreviewUserId === userId) {
      const now = new Date().toISOString()
      const existingByKey = new Map(get().items.map((item) => [item.category_key, item]))
      const saved = keys.map((categoryKey, position): CategoryGroupItem => {
        const existing = existingByKey.get(categoryKey)
        return {
          account_id: existing?.account_id ?? localPreviewAccountId(),
          user_id: userId,
          category_key: categoryKey,
          group_id: groupId,
          position,
          created_at: existing?.created_at ?? now,
          updated_at: now,
        }
      })
      const affected = new Set([...currentKeys, ...keys])
      const items = [
        ...get().items.filter((item) => !affected.has(item.category_key)),
        ...saved,
      ]
      set({ items, error: null })
      writeLocalPreview(userId, get().groups, items)
      return true
    }

    const rows = keys.map((categoryKey, position) => ({
      user_id: userId,
      category_key: categoryKey,
      group_id: groupId,
      position,
    }))
    const { data, error } = await supabase
      .from('notas_category_group_items')
      .upsert(rows, { onConflict: 'account_id,user_id,category_key' })
      .select('*')

    if (error) {
      console.error('[category-groups] reorderCategories:', error.message)
      set({ error: error.message })
      return false
    }

    if (useAuthStore.getState().getEffectiveUserId() === userId) {
      const saved = (data ?? []) as CategoryGroupItem[]
      const affected = new Set([...currentKeys, ...keys])
      set((state) => ({
        items: [
          ...state.items.filter((item) => !affected.has(item.category_key)),
          ...saved,
        ],
        error: null,
      }))
    }
    return true
  },

  clear: () => {
    loadGeneration += 1
    set({
      groups: [], items: [], isLoading: false, error: null,
      loadedUserId: null, localPreviewUserId: null,
    })
  },
}))
