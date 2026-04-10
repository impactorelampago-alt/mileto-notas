import { useRef, useState } from 'react'
import { X, Plus, Pin, Users } from 'lucide-react'
import { useNotesStore } from '../../stores/notes-store'
import { useCategoriesStore } from '../../stores/categories-store'
import { useOpsStore } from '../../stores/ops-store'

export default function TabBar() {
  const { openTabs, activeTabId, notes, setActiveTab, closeTab, createNote, noteIdsWithCollaborators } = useNotesStore()
  const getCategoryById = useCategoriesStore((s) => s.getCategoryById)
  const { sections, tasks } = useOpsStore()
  const [hoveredTab, setHoveredTab] = useState<string | null>(null)
  const tabsRef = useRef<HTMLDivElement>(null)

  const getNoteColor = (noteId: string): string | null => {
    const note = notes.find(n => n.id === noteId)
    if (!note?.task_id) return null
    const task = tasks.find(t => t.id === note.task_id)
    if (!task) return null
    const section = sections.find(s => task.status.endsWith(s.key_suffix))
    return section?.color ?? null
  }

  const getNote = (noteId: string) => notes.find((n) => n.id === noteId)
  const getTitle = (noteId: string) => getNote(noteId)?.title ?? 'Sem título'

  const handleWheel = (e: React.WheelEvent) => {
    if (tabsRef.current) {
      e.preventDefault()
      tabsRef.current.scrollLeft += e.deltaY
    }
  }

  if (openTabs.length === 0) {
    return (
      <div
        className="flex shrink-0 items-center justify-between"
        style={{
          backgroundColor: '#252526',
          borderRadius: '10px',
          margin: '4px 8px 0 8px',
          padding: '4px 8px',
          height: '38px',
        }}
      >
        <span className="text-[12px]" style={{ color: '#6d6d6d', paddingLeft: '8px' }}>Nenhuma nota aberta</span>
        <button
          onClick={() => void createNote()}
          className="flex shrink-0 items-center justify-center transition-colors duration-150"
          style={{ color: '#6d6d6d', borderRadius: '8px', padding: '6px 8px' }}
          onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = '#333333'; e.currentTarget.style.color = '#cccccc' }}
          onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; e.currentTarget.style.color = '#6d6d6d' }}
          title="Nova nota"
        >
          <Plus size={16} />
        </button>
      </div>
    )
  }

  return (
    <div
      className="flex shrink-0 items-end"
      style={{
        backgroundColor: '#252526',
        borderRadius: '10px',
        margin: '4px 8px 0 8px',
        padding: '4px 8px 0 8px',
      }}
    >
      <div
        ref={tabsRef}
        className="tabs-scroll flex flex-1 items-end gap-1"
        style={{ overflowX: 'auto' }}
        onWheel={handleWheel}
      >
        {openTabs.map((noteId) => {
          const isActive = noteId === activeTabId
          const isHovered = noteId === hoveredTab
          const note = getNote(noteId)
          const category = note?.category_id ? getCategoryById(note.category_id) : undefined

          return (
            <button
              key={noteId}
              onClick={() => setActiveTab(noteId)}
              onMouseEnter={() => setHoveredTab(noteId)}
              onMouseLeave={() => setHoveredTab(null)}
              className="group relative flex items-center gap-2 transition-colors duration-150"
              style={{
                borderRadius: '8px 8px 0 0',
                padding: '6px 16px',
                minWidth: '120px',
                maxWidth: '200px',
                flexShrink: 0,
                ...(isActive
                  ? {
                      backgroundColor: '#2d2d2d',
                      color: '#cccccc',
                      borderBottom: '2px solid #10b981',
                    }
                  : {
                      backgroundColor: isHovered ? '#2a2a2a' : 'transparent',
                      color: isHovered ? '#969696' : '#6d6d6d',
                    }),
              }}
            >
              {(() => {
                const color = getNoteColor(noteId)
                return color ? (
                  <span style={{ width: 8, height: 8, borderRadius: '50%', backgroundColor: color, flexShrink: 0 }} />
                ) : null
              })()}
              {note?.is_pinned && <Pin size={12} style={{ color: '#10b981', flexShrink: 0 }} />}
              {category && (
                <span style={{ width: 8, height: 8, borderRadius: '50%', backgroundColor: category.color, flexShrink: 0 }} />
              )}
              <span
                className="text-[13px]"
                style={{
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                  flex: 1,
                  minWidth: 0,
                }}
              >
                {getTitle(noteId)}
              </span>
              {noteIdsWithCollaborators.has(noteId) && (
                <Users size={10} style={{ color: '#34d399', flexShrink: 0, marginLeft: 3 }} />
              )}
              {(isActive || isHovered) && (
                <span
                  onClick={(e) => {
                    e.stopPropagation()
                    closeTab(noteId)
                  }}
                  className="flex shrink-0 items-center justify-center rounded-sm transition-colors duration-150"
                  style={{ color: '#6d6d6d', padding: '4px' }}
                  onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = '#333333'; e.currentTarget.style.color = '#cccccc' }}
                  onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; e.currentTarget.style.color = '#6d6d6d' }}
                >
                  <X size={14} />
                </span>
              )}
            </button>
          )
        })}
      </div>

      <button
        onClick={() => void createNote()}
        className="flex shrink-0 items-center justify-center transition-colors duration-150"
        style={{ color: '#6d6d6d', borderRadius: '8px', padding: '6px 8px', marginLeft: '4px' }}
        onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = '#333333'; e.currentTarget.style.color = '#cccccc' }}
        onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; e.currentTarget.style.color = '#6d6d6d' }}
        title="Nova nota"
      >
        <Plus size={16} />
      </button>
    </div>
  )
}
