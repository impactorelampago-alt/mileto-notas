import { useMemo, useRef, useState, useEffect } from 'react'
import { Check, ChevronDown, ChevronRight, Code2, Folder, FolderPlus, Plus, Pencil, Trash2, Users, Lock, Search, X } from 'lucide-react'
import { useOpsStore, SYSTEM_SUFFIXES, HIDDEN_LEGACY_SUFFIXES, IMMUTABLE_SUFFIXES, normalizeLabel } from '../../stores/ops-store'
import { useNotesStore } from '../../stores/notes-store'
import { useAuthStore } from '../../stores/auth-store'
import { useUIStore } from '../../stores/ui-store'
import { useSharingStore } from '../../stores/sharing-store'
import { useCategoryGroupsStore, type CategoryGroup } from '../../stores/category-groups-store'
import { sectionDisplayLabel } from '../../lib/sections'
import { isDoneStatus, getStatusBase } from '../../lib/status-keys'
import { useProgramHistoryStore } from '../../stores/program-history-store'

const SECTION_COLORS = [
  '#3b82f6', '#10b981', '#ef4444', '#f59e0b',
  '#8b5cf6', '#ec4899', '#f97316', '#06b6d4',
]

function normalizeSearch(value: string): string {
  return value.normalize('NFD').replace(new RegExp('\\p{Diacritic}', 'gu'), '').toLowerCase()
}

/**
 * Seletor de categoria no titlebar. Permite buscar, organizar em grupos
 * recolhíveis, renomear, compartilhar e excluir sem perder conteúdo. Somente
 * Lembrete é fixo; "Nova categoria" permite escolher cor e compartilhamento.
 */
export default function CategorySelect() {
  const sections = useOpsStore((s) => s.sections)
  const activeSectionId = useOpsStore((s) => s.activeSectionId)
  const setActiveSectionId = useOpsStore((s) => s.setActiveSectionId)
  const createSection = useOpsStore((s) => s.createSection)
  const updateSection = useOpsStore((s) => s.updateSection)
  const tasks = useOpsStore((s) => s.tasks)
  const reorderSections = useOpsStore((s) => s.reorderSections)
  const notes = useNotesStore((s) => s.notes)
  const completedOrigins = useNotesStore((s) => s.completedOrigins)
  const setDeleteSectionKeySuffix = useUIStore((s) => s.setDeleteSectionKeySuffix)
  const setSharePickerTarget = useUIStore((s) => s.setSharePickerTarget)
  const openConfirm = useUIStore((s) => s.openConfirm)
  const categoryShares = useSharingStore((s) => s.categoryShares)
  const storedGroups = useCategoryGroupsStore((s) => s.groups)
  const storedGroupItems = useCategoryGroupsStore((s) => s.items)
  const loadedGroupUserId = useCategoryGroupsStore((s) => s.loadedUserId)
  const groupError = useCategoryGroupsStore((s) => s.error)
  const createGroup = useCategoryGroupsStore((s) => s.createGroup)
  const renameGroup = useCategoryGroupsStore((s) => s.renameGroup)
  const deleteGroup = useCategoryGroupsStore((s) => s.deleteGroup)
  const toggleGroup = useCategoryGroupsStore((s) => s.toggleGroup)
  const assignCategory = useCategoryGroupsStore((s) => s.assignCategory)
  const reorderGroupCategories = useCategoryGroupsStore((s) => s.reorderCategories)
  const isCategoryOwner = useAuthStore((s) => s.isCategoryOwner)
  const viewAll = useAuthStore((s) => s.viewAll)
  const viewingAs = useAuthStore((s) => s.viewingAs)
  const realUserId = useAuthStore((s) => s.user?.id ?? null)
  const effectiveUserId = viewingAs?.id ?? realUserId
  const groupSnapshotReady = !!effectiveUserId && loadedGroupUserId === effectiveUserId
  const groups = groupSnapshotReady ? storedGroups : []
  const groupItems = groupSnapshotReady ? storedGroupItems : []
  const programs = useProgramHistoryStore((s) => s.programs)
  const programAccess = useProgramHistoryStore((s) => s.accessLevel)
  const setCategoryProgram = useProgramHistoryStore((s) => s.setCategoryProgram)
  const loadPrograms = useProgramHistoryStore((s) => s.loadPrograms)
  const canConfigurePrograms = programAccess !== 'NONE'

  const [isOpen, setIsOpen] = useState(false)
  const [isCreating, setIsCreating] = useState(false)
  const [isCreatingGroup, setIsCreatingGroup] = useState(false)
  const [newLabel, setNewLabel] = useState('')
  const [newColor, setNewColor] = useState(SECTION_COLORS[0])
  const [newShared, setNewShared] = useState(false)
  const [newProgram, setNewProgram] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [hoveredSuffix, setHoveredSuffix] = useState<string | null>(null)
  const [renamingSuffix, setRenamingSuffix] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [dragKey, setDragKey] = useState<string | null>(null)
  const [dragOverKey, setDragOverKey] = useState<string | null>(null)
  const [dragOverGroupId, setDragOverGroupId] = useState<string | null | undefined>(undefined)
  // Trava o arrastar da linha enquanto o mouse está sobre os botões de ação
  // (compartilhar/renomear/excluir) — senão um mousedown+arrasto neles iniciaria
  // o drag de reordenar a categoria inteira (o dragstart sobe pro ancestral).
  const [actionsHovered, setActionsHovered] = useState(false)
  const [search, setSearch] = useState('')
  const [newGroupName, setNewGroupName] = useState('')
  const [renamingGroupId, setRenamingGroupId] = useState<string | null>(null)
  const [groupRenameValue, setGroupRenameValue] = useState('')
  const [actionError, setActionError] = useState<string | null>(null)

  const containerRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const renameInputRef = useRef<HTMLInputElement>(null)
  const searchInputRef = useRef<HTMLInputElement>(null)
  const groupInputRef = useRef<HTMLInputElement>(null)
  const groupRenameInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (isCreating) inputRef.current?.focus()
  }, [isCreating])

  useEffect(() => {
    if (isCreatingGroup) groupInputRef.current?.focus()
  }, [isCreatingGroup])

  useEffect(() => {
    if (renamingGroupId) setTimeout(() => groupRenameInputRef.current?.select(), 0)
  }, [renamingGroupId])

  useEffect(() => {
    if (isOpen) {
      setSearch('')
      setActionError(null)
      searchInputRef.current?.focus()
    }
  }, [isOpen])

  useEffect(() => {
    if (renamingSuffix) setTimeout(() => renameInputRef.current?.select(), 0)
  }, [renamingSuffix])

  useEffect(() => {
    if (!isOpen) return
    const onMouseDown = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false)
        setIsCreating(false)
        setIsCreatingGroup(false)
        setRenamingSuffix(null)
        setRenamingGroupId(null)
      }
    }
    window.addEventListener('mousedown', onMouseDown)
    return () => window.removeEventListener('mousedown', onMouseDown)
  }, [isOpen])

  const counts = useMemo(() => {
    const taskToSuffix = new Map<string, string>()
    for (const task of tasks) {
      // Casamento igual ao TabBar: key completa (próprias/compartilhadas) com
      // fallback por sufixo p/ sistema. Concluída conta em "Concluído" (DONE).
      const effStatus = task.status
      let section
      if (viewAll) {
        section = sections.find((s) => s.key_suffix === getStatusBase(effStatus))
      } else {
        section = sections.find((s) => effStatus === s.key)
        if (!section) {
          const base = getStatusBase(effStatus)
          if (SYSTEM_SUFFIXES.has(base)) {
            section = sections.find((s) => s.key_suffix === base)
          }
        }
      }
      // Rede de segurança (igual ao TabBar): DONE sem seção "Concluído" → conta na origem.
      if (!section && isDoneStatus(task.status) && completedOrigins[task.id]) {
        const origin = completedOrigins[task.id]
        section =
          sections.find((s) => s.key === origin) ??
          (SYSTEM_SUFFIXES.has(getStatusBase(origin))
            ? sections.find((s) => s.key_suffix === getStatusBase(origin))
            : undefined)
      }
      // Durante a transição do workflow antigo, nenhuma nota some: statuses
      // legados ocultos caem visualmente em Lembrete até a migration movê-los.
      if (!section && HIDDEN_LEGACY_SUFFIXES.has(getStatusBase(task.status))) {
        section = sections.find((s) => s.key_suffix === 'TODO')
      }
      if (section) taskToSuffix.set(task.id, section.key_suffix)
    }
    const map = new Map<string, number>()
    for (const s of sections) map.set(s.key_suffix, 0)
    for (const note of notes) {
      if (!note.task_id) continue
      const suffix = taskToSuffix.get(note.task_id)
      if (suffix) map.set(suffix, (map.get(suffix) ?? 0) + 1)
    }
    return map
  }, [sections, tasks, notes, viewAll, completedOrigins])

  const active = sections.find((s) => s.key_suffix === activeSectionId) ?? null
  const activeIsProgram = !!active && programs.some((program) => program.active && program.category_key === active.key)
  const filteredSections = useMemo(() => {
    const query = normalizeSearch(search.trim())
    if (!query) return sections
    const searchable = (section: (typeof sections)[number]) =>
      normalizeSearch(sectionDisplayLabel(section.key_suffix, section.label))
    return sections
      .filter((section) => searchable(section).includes(query))
      .sort(
        (a, b) =>
          (searchable(a).startsWith(query) ? 0 : 1) -
          (searchable(b).startsWith(query) ? 0 : 1),
      )
  }, [sections, search])

  const canOrganizeGroups = !viewAll && !viewingAs && groupSnapshotReady
  const categoryGroupByKey = useMemo(
    () => new Map(groupItems.map((item) => [item.category_key, item.group_id])),
    [groupItems],
  )
  const categoryGroupPosition = useMemo(
    () => new Map(groupItems.map((item) => [item.category_key, item.position])),
    [groupItems],
  )

  type CategoryListRow =
    | { kind: 'section'; section: (typeof sections)[number] }
    | { kind: 'group'; group: CategoryGroup; sections: (typeof sections)[number][] }
    | { kind: 'ungrouped'; sections: (typeof sections)[number][] }

  const listRows = useMemo<CategoryListRow[]>(() => {
    // Buscar sempre revela todos os resultados, inclusive dentro de grupo fechado.
    // Em Todos/impersonação mostramos a lista plana para nunca esconder categorias
    // com uma preferência que somente o dono daquela conta pode alterar.
    if (search.trim() || !canOrganizeGroups) {
      return filteredSections.map((section) => ({ kind: 'section', section }))
    }

    const rows: CategoryListRow[] = []
    const reminder = sections.find((section) => section.key_suffix === 'TODO')
    if (reminder) rows.push({ kind: 'section', section: reminder })

    const validGroupIds = new Set(groups.map((group) => group.id))
    for (const group of groups) {
      const members = sections
        .filter((section) =>
          section.key_suffix !== 'TODO' && categoryGroupByKey.get(section.key) === group.id,
        )
        .sort((a, b) =>
          (categoryGroupPosition.get(a.key) ?? Number.MAX_SAFE_INTEGER)
          - (categoryGroupPosition.get(b.key) ?? Number.MAX_SAFE_INTEGER),
        )
      rows.push({ kind: 'group', group, sections: members })
      if (!group.collapsed) {
        rows.push(...members.map((section) => ({ kind: 'section' as const, section })))
      }
    }

    const ungrouped = sections
      .filter((section) => {
        if (section.key_suffix === 'TODO') return false
        const groupId = categoryGroupByKey.get(section.key)
        return !groupId || !validGroupIds.has(groupId)
      })
      .sort((a, b) =>
        (categoryGroupPosition.get(a.key) ?? Number.MAX_SAFE_INTEGER)
        - (categoryGroupPosition.get(b.key) ?? Number.MAX_SAFE_INTEGER),
      )
    if (groups.length > 0) rows.push({ kind: 'ungrouped', sections: ungrouped })
    rows.push(...ungrouped.map((section) => ({ kind: 'section' as const, section })))
    return rows
  }, [search, canOrganizeGroups, filteredSections, sections, groups, categoryGroupByKey, categoryGroupPosition])

  // Arrastar pra reordenar categorias: só as PRÓPRIAS (não as compartilhadas), e
  // só na sua conta (fora de "Todos"/impersonação). Grava custom_statuses.position
  // (reflete no board do Ops). As compartilhadas não entram (são de outro dono).
  const canReorderCats = !viewAll && !viewingAs && search.trim() === ''
  const handleGroupDrop = (groupId: string | null) => {
    const sourceKey = dragKey
    setDragKey(null)
    setDragOverKey(null)
    setDragOverGroupId(undefined)
    if (!sourceKey || !canOrganizeGroups) return
    const source = sections.find((section) => section.key === sourceKey)
    if (!source || source.key_suffix === 'TODO') return
    void assignCategory(sourceKey, groupId)
  }

  const handleCatDrop = (targetKey: string) => {
    const src = dragKey
    setDragKey(null)
    setDragOverKey(null)
    if (!src || src === targetKey || !canReorderCats) return

    // Com grupos, a ordem é pessoal ao Notas. Soltar sobre uma categoria de
    // outro grupo também a move para esse grupo.
    if (canOrganizeGroups && groups.length > 0) {
      const source = sections.find((section) => section.key === src)
      const target = sections.find((section) => section.key === targetKey)
      if (!source || !target || source.key_suffix === 'TODO' || target.key_suffix === 'TODO') return
      const sourceGroup = categoryGroupByKey.get(src) ?? null
      const targetGroup = categoryGroupByKey.get(targetKey) ?? null
      if (sourceGroup !== targetGroup) {
        void assignCategory(src, targetGroup)
        return
      }
      const ordered = sections
        .filter((section) =>
          section.key_suffix !== 'TODO'
          && (categoryGroupByKey.get(section.key) ?? null) === targetGroup,
        )
        .sort((a, b) =>
          (categoryGroupPosition.get(a.key) ?? Number.MAX_SAFE_INTEGER)
          - (categoryGroupPosition.get(b.key) ?? Number.MAX_SAFE_INTEGER),
        )
        .map((section) => section.key)
      const from = ordered.indexOf(src)
      const to = ordered.indexOf(targetKey)
      if (from < 0 || to < 0) return
      ordered.splice(from, 1)
      ordered.splice(to, 0, src)
      void reorderGroupCategories(targetGroup, ordered)
      return
    }

    const own = sections.filter((s) => !s.shared).map((s) => s.key)
    const from = own.indexOf(src)
    const to = own.indexOf(targetKey)
    if (from < 0 || to < 0) return
    own.splice(from, 1)
    own.splice(to, 0, src)
    void reorderSections(own)
  }

  const select = (suffix: string) => {
    setActiveSectionId(suffix)
    setIsOpen(false)
    setIsCreating(false)
    setIsCreatingGroup(false)
  }

  const startRename = (suffix: string, currentLabel: string) => {
    setRenamingSuffix(suffix)
    setRenameValue(currentLabel)
  }

  const confirmRename = async (suffix: string) => {
    const label = renameValue.trim()
    setRenamingSuffix(null)
    const current = sections.find((s) => s.key_suffix === suffix)?.label
    if (label && label !== current) {
      await updateSection(suffix, { label })
      const section = sections.find((item) => item.key_suffix === suffix)
      if (section && programs.some((program) => program.active && program.category_key === section.key)) {
        await loadPrograms()
      }
    }
  }

  const requestDelete = (suffix: string) => {
    setIsOpen(false)
    setDeleteSectionKeySuffix(suffix)
  }

  const openCreate = () => {
    setActionError(null)
    setNewColor(SECTION_COLORS[sections.length % SECTION_COLORS.length])
    setNewShared(false)
    setNewProgram(false)
    setNewLabel('')
    setIsCreatingGroup(false)
    setIsCreating(true)
  }

  const openCreateGroup = () => {
    setActionError(null)
    setNewGroupName('')
    setIsCreating(false)
    setIsCreatingGroup(true)
  }

  const handleCreateGroup = async () => {
    const name = newGroupName.trim()
    if (!name || isSubmitting || !canOrganizeGroups) return
    setActionError(null)
    setIsSubmitting(true)
    try {
      const created = await createGroup(name)
      if (created) {
        setNewGroupName('')
        setIsCreatingGroup(false)
      } else {
        setActionError(useCategoryGroupsStore.getState().error ?? 'Não foi possível criar o grupo.')
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Não foi possível criar o grupo.'
      setActionError(message)
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleDeleteGroup = async (groupId: string) => {
    setActionError(null)
    try {
      const deleted = await deleteGroup(groupId)
      if (!deleted) {
        setActionError(useCategoryGroupsStore.getState().error ?? 'Não foi possível excluir o grupo.')
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Não foi possível excluir o grupo.'
      setActionError(message)
    }
  }

  const requestDeleteGroup = (group: CategoryGroup) => {
    openConfirm({
      title: `Excluir grupo "${group.name}"`,
      message: 'As categorias serão preservadas e voltarão para “Sem grupo”.',
      confirmLabel: 'Excluir grupo',
      danger: true,
      onConfirm: () => { void handleDeleteGroup(group.id) },
    })
  }

  const confirmGroupRename = async (groupId: string) => {
    const name = groupRenameValue.trim()
    setRenamingGroupId(null)
    if (name) await renameGroup(groupId, name)
  }

  const handleCreate = async () => {
    const label = newLabel.trim()
    if (!label || isSubmitting || viewAll || viewingAs) return
    const suffix = normalizeLabel(label)
    if (!suffix) {
      setActionError('O nome precisa ter pelo menos uma letra ou número.')
      return
    }
    if (SYSTEM_SUFFIXES.has(suffix) || suffix === 'LEMBRETE') {
      setActionError('Esse nome é reservado pelo sistema. Escolha outro nome para a categoria.')
      return
    }
    setActionError(null)
    setIsSubmitting(true)
    try {
      const ok = await createSection(label, newColor)
      if (!ok) {
        setActionError('Não foi possível criar a categoria. Verifique se esse nome já existe.')
        return
      }
      const shareAfter = newShared
      const programAfter = newProgram
      const created = useOpsStore.getState().sections.find((sec) => sec.key_suffix === suffix)
      setNewLabel('')
      setNewShared(false)
      setNewProgram(false)
      setIsCreating(false)
      if (programAfter && created) {
        const marked = await setCategoryProgram(created.key, true)
        if (!marked) {
          setActionError(useProgramHistoryStore.getState().error ?? 'A categoria foi criada, mas não foi possível marcá-la como programa.')
        }
      }
      if (shareAfter) {
        if (created) {
          setIsOpen(false)
          setSharePickerTarget({ kind: 'category', id: created.key, label })
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Não foi possível criar a categoria.'
      setActionError(message)
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div ref={containerRef} className="titlebar-no-drag relative">
      <button
        onClick={() => setIsOpen((v) => !v)}
        className="flex items-center gap-2 rounded-md px-2.5 py-1 transition-colors"
        style={{ backgroundColor: isOpen ? '#2a2a2a' : 'transparent' }}
        onMouseEnter={(e) => { if (!isOpen) e.currentTarget.style.backgroundColor = '#232323' }}
        onMouseLeave={(e) => { if (!isOpen) e.currentTarget.style.backgroundColor = 'transparent' }}
      >
        <span style={{ width: 8, height: 8, borderRadius: 999, backgroundColor: active?.color ?? '#52525b', flexShrink: 0 }} />
        {activeIsProgram && <Code2 size={12} style={{ color: '#34d399', flexShrink: 0 }} />}
        <span className="truncate" style={{ color: '#e4e4e7', fontSize: '12.5px', fontWeight: 600, maxWidth: 170 }}>
          {active ? sectionDisplayLabel(active.key_suffix, active.label) : 'Escolher categoria'}
        </span>
        <ChevronDown
          size={13}
          style={{ color: '#71717a', transform: isOpen ? 'rotate(180deg)' : 'none', transition: 'transform 160ms ease' }}
        />
      </button>

      {isOpen && (
        <div
          className="absolute left-0 z-50"
          style={{
            top: 'calc(100% + 6px)',
            minWidth: 280,
            backgroundColor: '#202020',
            border: '1px solid #353535',
            borderRadius: 12,
            boxShadow: '0 16px 40px rgba(0,0,0,0.55)',
            overflow: 'hidden',
          }}
        >
          <div style={{ padding: '10px 12px 6px' }}>
            <span style={{ fontSize: '10.5px', fontWeight: 600, letterSpacing: '0.6px', color: '#6d6d75', textTransform: 'uppercase' }}>
              Categorias
            </span>
          </div>

          <div
            className="flex items-center"
            style={{
              gap: 8,
              margin: '0 12px 8px',
              padding: '6px 9px',
              backgroundColor: '#1a1a1a',
              border: '1px solid #333',
              borderRadius: 8,
            }}
          >
            <Search size={14} style={{ color: '#7d7d85', flexShrink: 0 }} />
            <input
              ref={searchInputRef}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => {
                e.stopPropagation()
                if (e.key === 'Escape') {
                  if (search) setSearch('')
                  else setIsOpen(false)
                  return
                }
                if (e.key === 'Enter') {
                  const first = filteredSections[0]
                  if (first) select(first.key_suffix)
                }
              }}
              onClick={(e) => e.stopPropagation()}
              placeholder="Buscar categoria..."
              className="min-w-0 flex-1 bg-transparent text-[12.5px] text-zinc-100 outline-none placeholder-zinc-600"
            />
            {search && (
              <span
                onClick={(e) => {
                  e.stopPropagation()
                  setSearch('')
                  searchInputRef.current?.focus()
                }}
                title="Limpar busca"
                className="flex items-center justify-center rounded"
                style={{ width: 18, height: 18, color: '#7d7d85', cursor: 'pointer', flexShrink: 0 }}
                onMouseEnter={(e) => { e.currentTarget.style.color = '#e4e4e7' }}
                onMouseLeave={(e) => { e.currentTarget.style.color = '#7d7d85' }}
              >
                <X size={13} />
              </span>
            )}
          </div>

          <div className="flex flex-col" style={{ gap: 2, padding: '0 8px 8px', maxHeight: 360, overflowY: 'auto' }}>
            {listRows.length === 0 && (
              <div style={{ padding: '14px 12px', textAlign: 'center', fontSize: '12.5px', color: '#6d6d75' }}>
                Nenhuma categoria encontrada
              </div>
            )}
            {listRows.map((row) => {
              if (row.kind === 'group') {
                const total = row.sections.reduce(
                  (sum, section) => sum + (counts.get(section.key_suffix) ?? 0),
                  0,
                )
                const isRenamingGroup = renamingGroupId === row.group.id
                const isDropTarget = dragOverGroupId === row.group.id
                return (
                  <div
                    key={`group:${row.group.id}`}
                    className="group flex items-center rounded-lg"
                    style={{
                      minHeight: 34,
                      gap: 7,
                      padding: '6px 8px',
                      color: '#a1a1aa',
                      backgroundColor: isDropTarget ? 'rgba(16,185,129,0.13)' : '#252525',
                      border: `1px solid ${isDropTarget ? 'rgba(52,211,153,0.45)' : 'transparent'}`,
                    }}
                    onClick={() => { if (!isRenamingGroup) void toggleGroup(row.group.id) }}
                    onDragOver={(event) => {
                      if (!dragKey || !canOrganizeGroups) return
                      event.preventDefault()
                      setDragOverGroupId(row.group.id)
                    }}
                    onDragLeave={() => setDragOverGroupId((current) => current === row.group.id ? undefined : current)}
                    onDrop={(event) => { event.preventDefault(); handleGroupDrop(row.group.id) }}
                  >
                    {row.group.collapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
                    <Folder size={14} style={{ color: 'var(--color-accent)', flexShrink: 0 }} />
                    {isRenamingGroup ? (
                      <input
                        ref={groupRenameInputRef}
                        value={groupRenameValue}
                        onChange={(event) => setGroupRenameValue(event.target.value)}
                        onClick={(event) => event.stopPropagation()}
                        onKeyDown={(event) => {
                          event.stopPropagation()
                          if (event.key === 'Enter') void confirmGroupRename(row.group.id)
                          if (event.key === 'Escape') setRenamingGroupId(null)
                        }}
                        onBlur={() => void confirmGroupRename(row.group.id)}
                        className="min-w-0 flex-1 bg-transparent text-[12.5px] text-zinc-100 outline-none"
                        style={{ borderBottom: '1px solid var(--color-accent)' }}
                      />
                    ) : (
                      <span className="min-w-0 flex-1 truncate text-[12.5px] font-medium">{row.group.name}</span>
                    )}
                    {!isRenamingGroup && (
                      <>
                        <span
                          style={{
                            minWidth: 20, height: 18, padding: '0 6px', borderRadius: 999,
                            backgroundColor: total > 0 ? '#323232' : 'transparent',
                            color: total > 0 ? '#a1a1aa' : '#5d5d65', fontSize: '10.5px',
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                          }}
                        >
                          {total}
                        </span>
                        <span
                          title="Renomear grupo"
                          onClick={(event) => {
                            event.stopPropagation()
                            setRenamingGroupId(row.group.id)
                            setGroupRenameValue(row.group.name)
                          }}
                          className="flex h-6 w-6 items-center justify-center rounded text-zinc-500 hover:bg-zinc-700 hover:text-zinc-200"
                        >
                          <Pencil size={12} />
                        </span>
                        <span
                          title="Excluir grupo (as categorias serão preservadas)"
                          onClick={(event) => { event.stopPropagation(); requestDeleteGroup(row.group) }}
                          className="flex h-6 w-6 items-center justify-center rounded text-zinc-500 hover:bg-red-950 hover:text-red-400"
                        >
                          <Trash2 size={12} />
                        </span>
                      </>
                    )}
                  </div>
                )
              }

              if (row.kind === 'ungrouped') {
                const total = row.sections.reduce(
                  (sum, section) => sum + (counts.get(section.key_suffix) ?? 0),
                  0,
                )
                const isDropTarget = dragOverGroupId === null
                return (
                  <div
                    key="group:ungrouped"
                    className="flex items-center rounded-lg"
                    style={{
                      minHeight: 31, gap: 7, padding: '5px 9px', color: '#71717a',
                      backgroundColor: isDropTarget ? 'rgba(16,185,129,0.10)' : 'transparent',
                      border: `1px dashed ${isDropTarget ? 'rgba(52,211,153,0.45)' : '#353535'}`,
                      fontSize: '11.5px',
                    }}
                    onDragOver={(event) => {
                      if (!dragKey || !canOrganizeGroups) return
                      event.preventDefault()
                      setDragOverGroupId(null)
                    }}
                    onDragLeave={() => setDragOverGroupId((current) => current === null ? undefined : current)}
                    onDrop={(event) => { event.preventDefault(); handleGroupDrop(null) }}
                  >
                    <Folder size={13} />
                    <span className="flex-1">Sem grupo</span>
                    <span>{total}</span>
                  </div>
                )
              }

              const s = row.section
              const isActive = s.key_suffix === activeSectionId
              const count = counts.get(s.key_suffix) ?? 0
              const isSystem = IMMUTABLE_SUFFIXES.has(s.key_suffix)
              const isRenaming = renamingSuffix === s.key_suffix
              const isHovered = hoveredSuffix === s.key_suffix
              // Categoria que EU compartilhei com outros (sai da minha conta).
              const isSharedByMe = (categoryShares[s.key]?.length ?? 0) > 0
              // Categoria compartilhada COMIGO (de outro dono — subordinada).
              const isSharedWithMe = s.shared === true
              const isOwner = isCategoryOwner(s.key)
              const isProgram = programs.some((program) => program.active && program.category_key === s.key)
              // Ações de dono só para categorias custom que SÃO minhas. No modo
              // "Todos" (visão agregada de leitura) não há gerenciamento.
              const canManage = !viewAll && isOwner && !isSystem && !isSharedWithMe
              // Classificar como programa é uma configuração do histórico, não
              // uma alteração da categoria. Destinatários podem fazê-la quando a
              // categoria foi realmente compartilhada com eles; as ações de dono
              // (renomear/compartilhar/excluir) continuam bloqueadas.
              const canConfigureThisProgram =
                !viewAll && !viewingAs && !isSystem && canConfigurePrograms && (isOwner || isSharedWithMe)
              const canDragForGroup = canOrganizeGroups && groups.length > 0 && s.key_suffix !== 'TODO'
              const canDragForOps = canReorderCats && !isSharedWithMe
              const belongsToGroup = !!categoryGroupByKey.get(s.key)

              return (
                <div
                  key={s.key}
                  onClick={() => { if (!isRenaming) select(s.key_suffix) }}
                  onMouseEnter={() => setHoveredSuffix(s.key_suffix)}
                  onMouseLeave={() => { setHoveredSuffix(null); setActionsHovered(false) }}
                  draggable={(canDragForGroup || canDragForOps) && !isRenaming && !actionsHovered}
                  onDragStart={(e) => {
                    if ((!canDragForGroup && !canDragForOps) || actionsHovered) { e.preventDefault(); return }
                    setDragKey(s.key)
                    e.dataTransfer.effectAllowed = 'move'
                    e.dataTransfer.setData('text/plain', s.key)
                  }}
                  onDragOver={(e) => {
                    if (canReorderCats && dragKey && dragKey !== s.key && s.key_suffix !== 'TODO') {
                      e.preventDefault()
                      if (dragOverKey !== s.key) setDragOverKey(s.key)
                    }
                  }}
                  onDragLeave={() => setDragOverKey((cur) => (cur === s.key ? null : cur))}
                  onDrop={(e) => { e.preventDefault(); handleCatDrop(s.key) }}
                  onDragEnd={() => { setDragKey(null); setDragOverKey(null); setDragOverGroupId(undefined) }}
                  className="relative flex w-full items-center rounded-lg"
                  style={{
                    gap: 11,
                    padding: `9px 12px 9px ${belongsToGroup ? 28 : 12}px`,
                    cursor: isRenaming ? 'default' : 'pointer',
                    backgroundColor: isActive ? 'rgba(16,185,129,0.10)' : isHovered ? '#2a2a2a' : 'transparent',
                    opacity: dragKey === s.key ? 0.4 : 1,
                    boxShadow: dragOverKey === s.key ? 'inset 0 2px 0 #10b981' : 'none',
                    transition: 'background-color 120ms, opacity 120ms',
                  }}
                >
                  {isActive && (
                    <span style={{ position: 'absolute', left: 0, top: 8, bottom: 8, width: 3, borderRadius: 999, backgroundColor: '#10b981' }} />
                  )}
                  {/* Acento contínuo nas compartilhadas comigo (mesmo sem hover/active) */}
                  {isSharedWithMe && !isActive && (
                    <span style={{ position: 'absolute', left: 0, top: 8, bottom: 8, width: 3, borderRadius: 999, backgroundColor: 'rgba(52,211,153,0.55)' }} />
                  )}
                  <span style={{ width: 9, height: 9, borderRadius: 999, backgroundColor: s.color, flexShrink: 0 }} />

                  {isRenaming ? (
                    <input
                      ref={renameInputRef}
                      value={renameValue}
                      onChange={(e) => setRenameValue(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') void confirmRename(s.key_suffix)
                        if (e.key === 'Escape') setRenamingSuffix(null)
                        e.stopPropagation()
                      }}
                      onBlur={() => void confirmRename(s.key_suffix)}
                      onClick={(e) => e.stopPropagation()}
                      className="min-w-0 flex-1 bg-transparent outline-none"
                      style={{ color: '#f4f4f5', fontSize: '13px', borderBottom: '1px solid #10b981' }}
                    />
                  ) : (
                    <span className="flex min-w-0 flex-1 items-center" style={{ gap: 7 }}>
                      <span className="truncate" style={{ color: isActive ? '#d1fae5' : '#e4e4e7', fontSize: '13px', fontWeight: isActive ? 500 : 400 }}>
                        {sectionDisplayLabel(s.key_suffix, s.label)}
                      </span>
                      {isSharedWithMe && (
                        <span
                          title="Categoria compartilhada com você por outra pessoa"
                          className="flex items-center"
                          style={{
                            gap: 4, flexShrink: 0,
                            height: 17, padding: '0 7px 0 6px', borderRadius: 999,
                            backgroundColor: 'rgba(16,185,129,0.16)',
                            border: '1px solid rgba(52,211,153,0.45)',
                            color: '#6ee7b7',
                            fontSize: '9.5px', fontWeight: 700, letterSpacing: '0.3px', textTransform: 'uppercase',
                          }}
                        >
                          <Users size={10} style={{ flexShrink: 0 }} />
                          Compartilhada
                        </span>
                      )}
                    </span>
                  )}

                  {!isRenaming && (
                    isHovered && (canManage || canConfigureThisProgram) ? (
                      <div
                        className="flex items-center"
                        style={{ gap: 2, flexShrink: 0 }}
                        onMouseEnter={() => setActionsHovered(true)}
                        onMouseLeave={() => setActionsHovered(false)}
                      >
                        {canConfigureThisProgram && (
                          <span
                            onClick={(e) => {
                              e.stopPropagation()
                              void (async () => {
                                const changed = await setCategoryProgram(s.key, !isProgram)
                                if (!changed) {
                                  setActionError(useProgramHistoryStore.getState().error ?? 'Não foi possível alterar o tipo da categoria.')
                                }
                              })()
                            }}
                            title={isProgram ? 'Remover tipo programa' : 'Marcar como programa'}
                            className="flex items-center justify-center rounded"
                            style={{ width: 22, height: 22, color: isProgram ? '#34d399' : '#8a8a92' }}
                            onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = 'rgba(16,185,129,0.14)'; e.currentTarget.style.color = '#34d399' }}
                            onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; e.currentTarget.style.color = isProgram ? '#34d399' : '#8a8a92' }}
                          >
                            <Code2 size={13} />
                          </span>
                        )}
                        {canManage && (
                          <>
                            <span
                              onClick={(e) => { e.stopPropagation(); setIsOpen(false); setSharePickerTarget({ kind: 'category', id: s.key, label: s.label }) }}
                              title="Compartilhar categoria"
                              className="flex items-center justify-center rounded"
                              style={{ width: 22, height: 22, color: isSharedByMe ? '#34d399' : '#8a8a92' }}
                              onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = 'rgba(16,185,129,0.14)'; e.currentTarget.style.color = '#34d399' }}
                              onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; e.currentTarget.style.color = isSharedByMe ? '#34d399' : '#8a8a92' }}
                            >
                              <Users size={14} />
                            </span>
                            <span
                              onClick={(e) => { e.stopPropagation(); startRename(s.key_suffix, s.label) }}
                              title="Renomear"
                              className="flex items-center justify-center rounded"
                              style={{ width: 22, height: 22, color: '#8a8a92' }}
                              onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = '#3a3a3a'; e.currentTarget.style.color = '#e4e4e7' }}
                              onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; e.currentTarget.style.color = '#8a8a92' }}
                            >
                              <Pencil size={13} />
                            </span>
                            <span
                              onClick={(e) => { e.stopPropagation(); requestDelete(s.key_suffix) }}
                              title="Excluir categoria"
                              className="flex items-center justify-center rounded"
                              style={{ width: 22, height: 22, color: '#8a8a92' }}
                              onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = 'rgba(239,68,68,0.14)'; e.currentTarget.style.color = '#ef4444' }}
                              onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; e.currentTarget.style.color = '#8a8a92' }}
                            >
                              <Trash2 size={13} />
                            </span>
                          </>
                        )}
                      </div>
                    ) : (
                      <div className="flex items-center" style={{ gap: 6, flexShrink: 0 }}>
                        {isProgram && <Code2 size={12} style={{ color: '#34d399' }} aria-label="Programa" />}
                        {isSharedByMe && !isSharedWithMe && <Users size={12} style={{ color: '#34d399' }} aria-label="Compartilhada por você" />}
                        <span
                          style={{
                            minWidth: 20, height: 18, padding: '0 6px', borderRadius: 999,
                            backgroundColor: count > 0 ? '#2e2e2e' : 'transparent',
                            color: count > 0 ? '#9a9aa3' : '#52525b',
                            fontSize: '10.5px', fontWeight: 500,
                            display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                          }}
                        >
                          {count}
                        </span>
                      </div>
                    )
                  )}
                </div>
              )
            })}
          </div>

          {(actionError || groupError) && (
            <div
              role="alert"
              style={{
                margin: '0 10px 8px', padding: '7px 9px', borderRadius: 7,
                border: '1px solid rgba(248,113,113,0.35)',
                backgroundColor: 'rgba(127,29,29,0.24)', color: '#fca5a5',
                fontSize: '11.5px', lineHeight: 1.35,
              }}
            >
              {actionError ?? groupError}
            </div>
          )}

          {!viewAll && !viewingAs && (
          <div style={{ borderTop: '1px solid #2a2a2a', padding: 8 }}>
            {isCreating ? (
              <div className="flex flex-col" style={{ gap: 10 }}>
                <input
                  ref={inputRef}
                  value={newLabel}
                  onChange={(e) => setNewLabel(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void handleCreate()
                    if (e.key === 'Escape') { setIsCreating(false); setNewLabel('') }
                  }}
                  placeholder="Nome da categoria..."
                  className="bg-transparent text-[12.5px] outline-none"
                  style={{ border: '1px solid #3f3f46', borderRadius: 6, padding: '7px 10px', color: '#e4e4e7' }}
                />

                {/* Cor + tipo programa + compartilhar */}
                <div className="flex items-center" style={{ gap: 6 }}>
                  {SECTION_COLORS.map((c) => {
                    const selected = newColor === c
                    return (
                      <span
                        key={c}
                        onClick={() => setNewColor(c)}
                        title="Escolher cor"
                        style={{
                          width: 18, height: 18, borderRadius: 999, backgroundColor: c, cursor: 'pointer', flexShrink: 0,
                          boxShadow: selected ? `0 0 0 2px #202020, 0 0 0 4px ${c}` : 'none',
                          transition: 'box-shadow 120ms',
                        }}
                      />
                    )
                  })}
                  {canConfigurePrograms && (
                    <button
                      onClick={() => setNewProgram((value) => !value)}
                      title={newProgram ? 'Categoria do tipo programa' : 'Marcar como programa'}
                      className="flex h-[30px] items-center gap-1.5 rounded-md"
                      style={{
                        marginLeft: 'auto', padding: '0 8px',
                        backgroundColor: newProgram ? 'rgba(16,185,129,0.14)' : 'transparent',
                        border: `1px solid ${newProgram ? 'rgba(16,185,129,0.35)' : '#3f3f46'}`,
                        color: newProgram ? '#34d399' : '#8a8a92',
                        fontSize: 10.5,
                      }}
                    >
                      <Code2 size={13} /> Programa
                    </button>
                  )}
                  <button
                    onClick={() => setNewShared((v) => !v)}
                    title={newShared ? 'Compartilhada com a equipe' : 'Privada (só você)'}
                    className="flex items-center justify-center rounded-md"
                    style={{
                      marginLeft: canConfigurePrograms ? 0 : 'auto', width: 30, height: 30,
                      backgroundColor: newShared ? 'rgba(16,185,129,0.14)' : 'transparent',
                      border: `1px solid ${newShared ? 'rgba(16,185,129,0.35)' : '#3f3f46'}`,
                      color: newShared ? '#34d399' : '#8a8a92',
                      transition: 'all 120ms',
                    }}
                  >
                    {newShared ? <Users size={15} /> : <Lock size={14} />}
                  </button>
                </div>

                <div className="flex items-center justify-end" style={{ gap: 6 }}>
                  <button
                    onClick={() => { setIsCreating(false); setNewLabel('') }}
                    className="rounded-md text-[12.5px] text-zinc-400 transition-colors hover:text-zinc-200"
                    style={{ height: 30, padding: '0 12px' }}
                  >
                    Cancelar
                  </button>
                  <button
                    onClick={() => void handleCreate()}
                    disabled={isSubmitting || !newLabel.trim()}
                    className="flex items-center gap-1.5 rounded-md text-[12.5px] font-medium text-white transition-colors disabled:opacity-40"
                    style={{ height: 30, padding: '0 14px', backgroundColor: '#10b981' }}
                  >
                    <Check size={14} /> Criar
                  </button>
                </div>
              </div>
            ) : isCreatingGroup ? (
              <div className="flex flex-col" style={{ gap: 9 }}>
                <div className="flex items-center" style={{ gap: 8 }}>
                  <FolderPlus size={15} style={{ color: 'var(--color-accent)', flexShrink: 0 }} />
                  <input
                    ref={groupInputRef}
                    value={newGroupName}
                    onChange={(event) => setNewGroupName(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') void handleCreateGroup()
                      if (event.key === 'Escape') { setIsCreatingGroup(false); setNewGroupName('') }
                    }}
                    placeholder="Nome do grupo..."
                    className="min-w-0 flex-1 bg-transparent text-[12.5px] text-zinc-100 outline-none"
                    style={{ border: '1px solid #3f3f46', borderRadius: 6, padding: '7px 10px' }}
                  />
                </div>
                <span style={{ fontSize: '10.5px', color: '#71717a' }}>
                  Depois, arraste categorias para dentro do grupo.
                </span>
                <div className="flex items-center justify-end" style={{ gap: 6 }}>
                  <button
                    onClick={() => { setIsCreatingGroup(false); setNewGroupName('') }}
                    className="rounded-md text-[12.5px] text-zinc-400 hover:text-zinc-200"
                    style={{ height: 30, padding: '0 12px' }}
                  >
                    Cancelar
                  </button>
                  <button
                    onClick={() => void handleCreateGroup()}
                    disabled={isSubmitting || !newGroupName.trim()}
                    className="flex items-center gap-1.5 rounded-md text-[12.5px] font-medium text-white disabled:opacity-40"
                    style={{ height: 30, padding: '0 14px', backgroundColor: 'var(--color-accent)' }}
                    onMouseEnter={(event) => { event.currentTarget.style.backgroundColor = 'var(--color-accent-hover)' }}
                    onMouseLeave={(event) => { event.currentTarget.style.backgroundColor = 'var(--color-accent)' }}
                  >
                    <Check size={14} /> Criar grupo
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex flex-col" style={{ gap: 2 }}>
                <button
                  onClick={openCreate}
                  className="flex w-full items-center rounded-lg text-left transition-colors"
                  style={{ gap: 11, padding: '9px 12px', color: '#a1a1aa' }}
                  onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = '#2a2a2a' }}
                  onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent' }}
                >
                  <span className="flex items-center justify-center" style={{ width: 9, flexShrink: 0 }}>
                    <Plus size={14} style={{ color: '#71717a' }} />
                  </span>
                  <span style={{ fontSize: '13px' }}>Nova categoria</span>
                </button>
                {canOrganizeGroups && (
                  <button
                    onClick={openCreateGroup}
                    className="flex w-full items-center rounded-lg text-left transition-colors"
                    style={{ gap: 11, padding: '9px 12px', color: '#a1a1aa' }}
                    onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = '#2a2a2a' }}
                    onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent' }}
                  >
                    <span className="flex items-center justify-center" style={{ width: 9, flexShrink: 0 }}>
                      <FolderPlus size={14} style={{ color: 'var(--color-accent)' }} />
                    </span>
                    <span style={{ fontSize: '13px' }}>Novo grupo recolhível</span>
                  </button>
                )}
              </div>
            )}
          </div>
          )}
        </div>
      )}
    </div>
  )
}
