import { useMemo, useRef, useState, useEffect } from 'react'
import { Check, ChevronDown, Plus, Pencil, Trash2, Users, Lock } from 'lucide-react'
import { useOpsStore, SYSTEM_SUFFIXES, normalizeLabel } from '../../stores/ops-store'
import { useNotesStore } from '../../stores/notes-store'
import { useAuthStore } from '../../stores/auth-store'
import { useUIStore } from '../../stores/ui-store'
import { useSharingStore } from '../../stores/sharing-store'
import { sectionDisplayLabel } from '../../lib/sections'
import { isDoneStatus, getStatusBase } from '../../lib/status-keys'

const SECTION_COLORS = [
  '#3b82f6', '#10b981', '#ef4444', '#f59e0b',
  '#8b5cf6', '#ec4899', '#f97316', '#06b6d4',
]

/**
 * Seletor de categoria no titlebar (abre como lista). Categorias custom podem
 * ser renomeadas (lápis) e excluídas (lixeira → modal que avisa se há notas
 * dentro). Categorias de sistema (workflow do Ops) são fixas. "Nova categoria"
 * permite escolher a cor e marcar se será compartilhada.
 */
export default function CategorySelect() {
  const sections = useOpsStore((s) => s.sections)
  const activeSectionId = useOpsStore((s) => s.activeSectionId)
  const setActiveSectionId = useOpsStore((s) => s.setActiveSectionId)
  const createSection = useOpsStore((s) => s.createSection)
  const updateSection = useOpsStore((s) => s.updateSection)
  const tasks = useOpsStore((s) => s.tasks)
  const notes = useNotesStore((s) => s.notes)
  const completedOrigins = useNotesStore((s) => s.completedOrigins)
  const setDeleteSectionKeySuffix = useUIStore((s) => s.setDeleteSectionKeySuffix)
  const setSharePickerTarget = useUIStore((s) => s.setSharePickerTarget)
  const categoryShares = useSharingStore((s) => s.categoryShares)
  const isCategoryOwner = useAuthStore((s) => s.isCategoryOwner)
  const viewAll = useAuthStore((s) => s.viewAll)

  const [isOpen, setIsOpen] = useState(false)
  const [isCreating, setIsCreating] = useState(false)
  const [newLabel, setNewLabel] = useState('')
  const [newColor, setNewColor] = useState(SECTION_COLORS[0])
  const [newShared, setNewShared] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [hoveredSuffix, setHoveredSuffix] = useState<string | null>(null)
  const [renamingSuffix, setRenamingSuffix] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')

  const containerRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const renameInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (isCreating) inputRef.current?.focus()
  }, [isCreating])

  useEffect(() => {
    if (renamingSuffix) setTimeout(() => renameInputRef.current?.select(), 0)
  }, [renamingSuffix])

  useEffect(() => {
    if (!isOpen) return
    const onMouseDown = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false)
        setIsCreating(false)
        setRenamingSuffix(null)
      }
    }
    window.addEventListener('mousedown', onMouseDown)
    return () => window.removeEventListener('mousedown', onMouseDown)
  }, [isOpen])

  const counts = useMemo(() => {
    const taskToSuffix = new Map<string, string>()
    for (const task of tasks) {
      // Mesmo casamento do TabBar: concluída conta na categoria de ORIGEM; depois
      // key completa (próprias/compartilhadas) com fallback por sufixo p/ sistema.
      const effStatus =
        isDoneStatus(task.status) && completedOrigins[task.id]
          ? completedOrigins[task.id]
          : task.status
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
  }, [sections, tasks, notes, completedOrigins, viewAll])

  const active = sections.find((s) => s.key_suffix === activeSectionId) ?? null

  const select = (suffix: string) => {
    setActiveSectionId(suffix)
    setIsOpen(false)
    setIsCreating(false)
  }

  const startRename = (suffix: string, currentLabel: string) => {
    setRenamingSuffix(suffix)
    setRenameValue(currentLabel)
  }

  const confirmRename = async (suffix: string) => {
    const label = renameValue.trim()
    setRenamingSuffix(null)
    const current = sections.find((s) => s.key_suffix === suffix)?.label
    if (label && label !== current) await updateSection(suffix, { label })
  }

  const requestDelete = (suffix: string) => {
    setIsOpen(false)
    setDeleteSectionKeySuffix(suffix)
  }

  const openCreate = () => {
    setNewColor(SECTION_COLORS[sections.length % SECTION_COLORS.length])
    setNewShared(false)
    setNewLabel('')
    setIsCreating(true)
  }

  const handleCreate = async () => {
    const label = newLabel.trim()
    if (!label || isSubmitting) return
    setIsSubmitting(true)
    const ok = await createSection(label, newColor)
    setIsSubmitting(false)
    if (ok) {
      const shareAfter = newShared
      setNewLabel('')
      setNewShared(false)
      setIsCreating(false)
      if (shareAfter) {
        const suffix = normalizeLabel(label)
        const created = useOpsStore.getState().sections.find((sec) => sec.key_suffix === suffix)
        if (created) {
          setIsOpen(false)
          setSharePickerTarget({ kind: 'category', id: created.key, label })
        }
      }
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

          <div className="flex flex-col" style={{ gap: 2, padding: '0 8px 8px', maxHeight: 360, overflowY: 'auto' }}>
            {sections.map((s) => {
              const isActive = s.key_suffix === activeSectionId
              const count = counts.get(s.key_suffix) ?? 0
              const isSystem = SYSTEM_SUFFIXES.has(s.key_suffix)
              const isRenaming = renamingSuffix === s.key_suffix
              const isHovered = hoveredSuffix === s.key_suffix
              // Categoria que EU compartilhei com outros (sai da minha conta).
              const isSharedByMe = (categoryShares[s.key]?.length ?? 0) > 0
              // Categoria compartilhada COMIGO (de outro dono — subordinada).
              const isSharedWithMe = s.shared === true
              const isOwner = isCategoryOwner(s.key)
              // Ações de dono só para categorias custom que SÃO minhas. No modo
              // "Todos" (visão agregada de leitura) não há gerenciamento.
              const canManage = !viewAll && isOwner && !isSystem && !isSharedWithMe

              return (
                <div
                  key={s.key}
                  onClick={() => { if (!isRenaming) select(s.key_suffix) }}
                  onMouseEnter={() => setHoveredSuffix(s.key_suffix)}
                  onMouseLeave={() => setHoveredSuffix(null)}
                  className="relative flex w-full items-center rounded-lg"
                  style={{
                    gap: 11,
                    padding: '9px 12px',
                    cursor: isRenaming ? 'default' : 'pointer',
                    backgroundColor: isActive ? 'rgba(16,185,129,0.10)' : isHovered ? '#2a2a2a' : 'transparent',
                    transition: 'background-color 120ms',
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
                    isHovered && canManage ? (
                      <div className="flex items-center" style={{ gap: 2, flexShrink: 0 }}>
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
                      </div>
                    ) : (
                      <div className="flex items-center" style={{ gap: 6, flexShrink: 0 }}>
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

          {!viewAll && (
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

                {/* Cor + compartilhar */}
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
                  <button
                    onClick={() => setNewShared((v) => !v)}
                    title={newShared ? 'Compartilhada com a equipe' : 'Privada (só você)'}
                    className="flex items-center justify-center rounded-md"
                    style={{
                      marginLeft: 'auto', width: 30, height: 30,
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
            ) : (
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
            )}
          </div>
          )}
        </div>
      )}
    </div>
  )
}
