import { useMemo, useRef, useState, useEffect } from 'react'
import { Check, Circle, Pin, Plus, Users, X } from 'lucide-react'
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
  const [isCreatingNote, setIsCreatingNote] = useState(false)
  const [newTitle, setNewTitle] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)

  const noteInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (isCreatingNote) {
      setTimeout(() => noteInputRef.current?.focus(), 0)
    }
  }, [isCreatingNote])

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

  const handleCreateNote = async () => {
    const title = newTitle.trim()
    if (!title || isSubmitting) return
    const sectionForCreate = activeSectionId
    setIsSubmitting(true)
    setNewTitle('')
    setIsCreatingNote(false)
    try {
      await createNote({ title, sectionSuffix: sectionForCreate })
    } catch (err) {
      console.error('[TabBar] createNote failed:', err)
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleCancelCreateNote = () => {
    setNewTitle('')
    setIsCreatingNote(false)
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

              <span className="truncate text-[12px]" style={{ color: isActive ? '#f4f4f5' : '#d4d4d8', maxWidth: 130 }}>
                {note.title || 'Sem título'}
              </span>

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

        {isCreatingNote ? (
          <div
            className={CARD_BASE_CLASSES}
            style={{
              ...CARD_WIDTH_STYLE,
              backgroundColor: '#1f1f1f',
              border: '1px solid #3f3f46',
            }}
          >
            <input
              ref={noteInputRef}
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void handleCreateNote()
                if (e.key === 'Escape') handleCancelCreateNote()
              }}
              placeholder="Nome da nota..."
              className="min-w-0 flex-1 bg-transparent text-[12px] text-zinc-200 outline-none placeholder:text-zinc-500"
            />
            <button
              onClick={() => void handleCreateNote()}
              disabled={isSubmitting || !newTitle.trim()}
              className="flex shrink-0 items-center justify-center rounded p-1 text-emerald-400 transition-colors disabled:opacity-40"
              title="Confirmar"
            >
              <Check size={14} />
            </button>
            <button
              onClick={handleCancelCreateNote}
              className="flex shrink-0 items-center justify-center rounded p-1 text-zinc-500 transition-colors hover:text-zinc-300"
              title="Cancelar"
            >
              <X size={14} />
            </button>
          </div>
        ) : (
          <button
            onClick={() => setIsCreatingNote(true)}
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
        )}
      </div>
    </div>
  )
}
