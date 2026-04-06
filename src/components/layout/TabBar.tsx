import { useState } from 'react'
import { X, Plus } from 'lucide-react'
import { useNotesStore } from '../../stores/notes-store'
import { useCategoriesStore } from '../../stores/categories-store'

export default function TabBar() {
  const { openTabs, activeTabId, notes, setActiveTab, closeTab, createNote } = useNotesStore()
  const selectedCategoryId = useCategoriesStore((s) => s.selectedCategoryId)
  const [hoveredTab, setHoveredTab] = useState<string | null>(null)

  const getTitle = (noteId: string) =>
    notes.find((n) => n.id === noteId)?.title ?? 'Sem título'

  if (openTabs.length === 0) {
    return (
      <div
        className="flex h-9 shrink-0 items-center justify-between bg-zinc-950 pl-1"
        style={{ boxShadow: '0 1px 0 0 rgba(16, 185, 129, 0.4)' }}
      >
        <span className="pl-3 text-[12px] text-zinc-600">Nenhuma nota aberta</span>
        <button
          onClick={() => void createNote(selectedCategoryId)}
          className="flex h-9 w-9 shrink-0 items-center justify-center text-zinc-600 transition-colors duration-150 hover:bg-zinc-900/50 hover:text-zinc-400"
          title="Nova nota"
        >
          <Plus size={14} />
        </button>
      </div>
    )
  }

  return (
    <div
      className="flex h-9 shrink-0 items-end bg-zinc-950 pl-1"
      style={{ boxShadow: '0 1px 0 0 rgba(16, 185, 129, 0.4)' }}
    >
      {openTabs.map((noteId) => {
        const isActive = noteId === activeTabId
        const isHovered = noteId === hoveredTab

        return (
          <button
            key={noteId}
            onClick={() => setActiveTab(noteId)}
            onMouseEnter={() => setHoveredTab(noteId)}
            onMouseLeave={() => setHoveredTab(null)}
            className="group relative flex h-9 max-w-[180px] items-center gap-2 px-4 transition-colors duration-150"
            style={
              isActive
                ? { backgroundColor: '#18181b', borderBottom: '2px solid #10b981', color: '#f4f4f5' }
                : {
                    backgroundColor: isHovered ? 'rgba(24, 24, 27, 0.5)' : 'transparent',
                    color: isHovered ? '#d4d4d8' : '#71717a',
                  }
            }
          >
            <span className="max-w-[120px] truncate text-[13px]">{getTitle(noteId)}</span>
            {(isActive || isHovered) && (
              <span
                onClick={(e) => {
                  e.stopPropagation()
                  closeTab(noteId)
                }}
                className="flex h-4 w-4 shrink-0 items-center justify-center rounded text-zinc-500 transition-colors duration-150 hover:text-zinc-300"
              >
                <X size={12} />
              </span>
            )}
          </button>
        )
      })}

      <button
        onClick={() => void createNote(selectedCategoryId)}
        className="flex h-9 w-9 shrink-0 items-center justify-center text-zinc-600 transition-colors duration-150 hover:bg-zinc-900/50 hover:text-zinc-400"
        title="Nova nota"
      >
        <Plus size={14} />
      </button>
    </div>
  )
}
