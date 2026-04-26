import { useMemo, useRef, useState, useEffect } from 'react'
import { Circle, Pin, Plus, Users, X } from 'lucide-react'
import { useNotesStore } from '../../stores/notes-store'
import { useCategoriesStore } from '../../stores/categories-store'
import { useOpsStore } from '../../stores/ops-store'
import { NOTE_PRIORITY_COLORS, normalizePriority } from '../../lib/note-priority'

type SectionGroup = {
  key: string
  label: string
  color: string
  noteIds: string[]
  isLoose?: boolean
}

export default function TabBar() {
  const {
    openTabs,
    activeTabId,
    notes,
    setActiveTab,
    openTab,
    createNote,
    noteIdsWithCollaborators,
    deleteNote,
    updateNote,
  } = useNotesStore()
  const categories = useCategoriesStore((s) => s.categories)
  const sections = useOpsStore((s) => s.sections)
  const activeSectionId = useOpsStore((s) => s.activeSectionId)
  const tasks = useOpsStore((s) => s.tasks)

  const [hoveredTab, setHoveredTab] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [renamingNoteId, setRenamingNoteId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [contextMenuNoteId, setContextMenuNoteId] = useState<string | null>(null)
  const [contextMenuPos, setContextMenuPos] = useState({ x: 0, y: 0 })

  const renameInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (renamingNoteId) setTimeout(() => renameInputRef.current?.focus(), 0)
  }, [renamingNoteId])

  useEffect(() => {
    if (!contextMenuNoteId) return
    const close = () => setContextMenuNoteId(null)
    window.addEventListener('click', close)
    return () => window.removeEventListener('click', close)
  }, [contextMenuNoteId])

  const taskToSectionMap = useMemo(() => {
    const map = new Map<string, string>()
    for (const task of tasks) {
      const section = sections.find((item) => task.status.endsWith(item.key_suffix))
      if (section) map.set(task.id, section.key_suffix)
    }
    return map
  }, [tasks, sections])

  const sectionGroups = useMemo<SectionGroup[]>(() => {
    const groups = new Map<string, SectionGroup>()
    for (const section of sections) {
      groups.set(section.key_suffix, {
        key: section.key_suffix,
        label: section.label,
        color: section.color,
        noteIds: [],
      })
    }
    for (const note of notes) {
      if (!note.task_id) continue
      const sectionKey = taskToSectionMap.get(note.task_id)
      if (!sectionKey) continue
      groups.get(sectionKey)?.noteIds.push(note.id)
    }
    return sections.map((s) => groups.get(s.key_suffix)!).filter(Boolean)
  }, [notes, sections, taskToSectionMap])

  const activeGroup = useMemo(
    () => sectionGroups.find((g) => g.key === activeSectionId) ?? null,
    [sectionGroups, activeSectionId],
  )

  const handleStartRename = (noteId: string, currentTitle: string) => {
    setRenamingNoteId(noteId)
    setRenameValue(currentTitle === 'Sem título' ? '' : currentTitle)
    setContextMenuNoteId(null)
  }

  const handleConfirmRename = async (noteId: string) => {
    const title = renameValue.trim()
    if (title) await updateNote(noteId, { title })
    setRenamingNoteId(null)
    setRenameValue('')
  }

  const handleCreateNote = async () => {
    if (isSubmitting) return
    setIsSubmitting(true)
    try {
      await createNote({ title: 'Sem título', sectionSuffix: activeSectionId })
    } catch (err) {
      console.error('[TabBar] createNote failed:', err)
    } finally {
      setIsSubmitting(false)
    }
  }

  if (!activeGroup) {
    return (
      <div style={{ padding: '6px 10px 0 10px' }}>
        <div
          className="flex items-center justify-center gap-2 rounded-xl px-4 py-10"
          style={{ backgroundColor: 'transparent', border: '1px dashed #27272a', color: '#52525b' }}
        >
          <Circle size={14} />
          <span style={{ fontSize: '13px' }}>Escolha uma categoria pra ver as notas</span>
        </div>
      </div>
    )
  }

  const CARD_BASE_CLASSES = 'flex items-center gap-1.5 rounded-lg px-3 py-2 text-left transition-colors'
  const CARD_WIDTH_STYLE = { maxWidth: 220 } as const

  return (
    <div style={{ padding: '6px 10px 0 10px' }}>
      <div className="flex flex-wrap gap-2.5">
        {activeGroup.noteIds.map((noteId) => {
          const note = notes.find((item) => item.id === noteId)
          if (!note) return null

          const isActive = noteId === activeTabId
          const isHovered = noteId === hoveredTab
          const isOpen = openTabs.includes(noteId)
          const priority = normalizePriority(note.priority)
          const priorityColors = NOTE_PRIORITY_COLORS[priority]
          const category = note.category_id ? categories.find((item) => item.id === note.category_id) : null

          return (
            <button
              key={noteId}
              onClick={() => {
                openTab(noteId)
                setActiveTab(noteId)
              }}
              onMouseEnter={() => setHoveredTab(noteId)}
              onMouseLeave={() => setHoveredTab(null)}
              className={`group relative ${CARD_BASE_CLASSES}`}
              style={{
                ...CARD_WIDTH_STYLE,
                backgroundColor: isActive ? priorityColors.bg : isHovered ? '#232323' : '#1a1a1a',
                border: `1px solid ${isActive ? priorityColors.dot : isOpen ? '#3f3f46' : '#262626'}`,
                color: '#d4d4d8',
              }}
              onContextMenu={(e) => {
                e.preventDefault()
                e.stopPropagation()
                setContextMenuPos({ x: e.clientX, y: e.clientY })
                setContextMenuNoteId(noteId)
              }}
            >
              <span
                onClick={(e) => {
                  e.stopPropagation()
                  void updateNote(noteId, {
                    priority:
                      priority === 'LOW'
                        ? 'MEDIUM'
                        : priority === 'MEDIUM'
                          ? 'HIGH'
                          : priority === 'HIGH'
                            ? 'URGENT'
                            : 'LOW',
                  })
                }}
                title={`Prioridade: ${priority}`}
                style={{
                  width: 7,
                  height: 7,
                  borderRadius: '999px',
                  backgroundColor: priorityColors.dot,
                  flexShrink: 0,
                }}
              />

              {category && (
                <span
                  title={category.name}
                  style={{
                    width: 6,
                    height: 6,
                    borderRadius: '999px',
                    backgroundColor: category.color,
                    flexShrink: 0,
                  }}
                />
              )}

              {note.is_pinned && <Pin size={10} style={{ color: '#10b981', flexShrink: 0 }} />}

              {renamingNoteId === noteId ? (
                <input
                  ref={renameInputRef}
                  value={renameValue}
                  onChange={(e) => setRenameValue(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void handleConfirmRename(noteId)
                    if (e.key === 'Escape') { setRenamingNoteId(null); setRenameValue('') }
                    e.stopPropagation()
                  }}
                  onBlur={() => void handleConfirmRename(noteId)}
                  onClick={(e) => e.stopPropagation()}
                  className="bg-transparent outline-none text-[12px] min-w-0"
                  style={{ color: '#f4f4f5', width: 110 }}
                  placeholder="Nome da nota..."
                />
              ) : (
                <span className="truncate text-[12px]" style={{ color: isActive ? '#f4f4f5' : '#d4d4d8', maxWidth: 130 }}>
                  {note.title || 'Sem título'}
                </span>
              )}

              {noteIdsWithCollaborators.has(noteId) && (
                <Users size={10} style={{ color: '#34d399', flexShrink: 0 }} />
              )}

              {(isActive || isHovered) && (
                <span
                  onClick={(e) => {
                    e.stopPropagation()
                    void deleteNote(noteId)
                  }}
                  className="flex shrink-0 items-center justify-center rounded transition-colors hover:text-red-400"
                  style={{ color: '#71717a', marginLeft: 2, marginRight: 1 }}
                >
                  <X size={11} />
                </span>
              )}
            </button>
          )
        })}

        <button
            onClick={() => void handleCreateNote()}
            disabled={isSubmitting}
            className={`${CARD_BASE_CLASSES} justify-center`}
            style={{
              ...CARD_WIDTH_STYLE,
              backgroundColor: 'transparent',
              border: '1px dashed #27272a',
              color: '#71717a',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.borderColor = '#3f3f46'
              e.currentTarget.style.color = '#a1a1aa'
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.borderColor = '#27272a'
              e.currentTarget.style.color = '#71717a'
            }}
            title="Nova nota"
          >
            <Plus size={12} />
            <span className="text-[11.5px]">Nova nota</span>
          </button>
      </div>

      {/* Menu contextual do card */}
      {contextMenuNoteId && (
        <div
          className="fixed z-50 overflow-hidden rounded-lg border"
          style={{
            left: contextMenuPos.x,
            top: contextMenuPos.y,
            backgroundColor: '#1e1e1e',
            borderColor: '#3d3d3d',
            boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
            minWidth: 140,
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            onClick={() => {
              const note = notes.find((n) => n.id === contextMenuNoteId)
              if (note) handleStartRename(note.id, note.title)
            }}
            className="flex w-full items-center gap-2 px-3 py-2 text-left text-[12px] text-zinc-200 transition-colors hover:bg-zinc-800"
          >
            Renomear
          </button>
        </div>
      )}
    </div>
  )
}
