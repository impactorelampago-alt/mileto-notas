import { useState, useRef, useEffect, useMemo } from 'react'
import { Search, FileText } from 'lucide-react'
import { useNotesStore } from '../../stores/notes-store'
import { useOpsStore } from '../../stores/ops-store'
import { useUIStore } from '../../stores/ui-store'
import { sectionDisplayLabel } from '../../lib/sections'

export default function QuickSearch() {
  const [query, setQuery] = useState('')
  const [selectedIndex, setSelectedIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const notes = useNotesStore((s) => s.notes)
  const openTab = useNotesStore((s) => s.openTab)
  const setShowQuickSearch = useUIStore((s) => s.setShowQuickSearch)
  const { sections, tasks } = useOpsStore()

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  const filtered = useMemo(() => {
    if (!query.trim()) return notes.slice(0, 20)
    const lower = query.toLowerCase()
    return notes.filter((n) =>
      n.title.toLowerCase().includes(lower) ||
      n.content.toLowerCase().includes(lower)
    ).slice(0, 20)
  }, [query, notes])

  useEffect(() => {
    setSelectedIndex(0)
  }, [query])

  const getSectionForNote = (taskId: string | null) => {
    if (!taskId) return null
    const task = tasks.find((t) => t.id === taskId)
    if (!task) return null
    const section = sections.find((s) => task.status.endsWith(s.key_suffix))
    return section ?? null
  }

  const setActiveSectionId = useOpsStore((s) => s.setActiveSectionId)

  const handleSelect = (noteId: string) => {
    const note = notes.find((n) => n.id === noteId)
    const section = note ? getSectionForNote(note.task_id) : null

    if (section) {
      setActiveSectionId(section.key_suffix)
      useNotesStore.getState().setActiveTab(noteId)
      openTab(noteId)
    } else {
      openTab(noteId)
    }

    setShowQuickSearch(false)
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setSelectedIndex((prev) => Math.min(prev + 1, filtered.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setSelectedIndex((prev) => Math.max(prev - 1, 0))
    } else if (e.key === 'Enter' && filtered[selectedIndex]) {
      e.preventDefault()
      handleSelect(filtered[selectedIndex].id)
    } else if (e.key === 'Escape') {
      setShowQuickSearch(false)
    }
  }

  return (
    // Captura de clique para fechar (sem escurecer a tela — comporta como dropdown)
    <div className="fixed inset-0 z-50" onClick={() => setShowQuickSearch(false)}>
      {/* Painel ancorado no topo-direito, "saindo" da lupa */}
      <div
        className="absolute overflow-hidden"
        style={{
          top: 46,
          right: 12,
          width: 460,
          backgroundColor: '#202020',
          border: '1px solid #353535',
          borderRadius: 12,
          boxShadow: '0 16px 44px rgba(0,0,0,0.6)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2.5 px-3.5 py-3" style={{ borderBottom: '1px solid #2a2a2a' }}>
          <Search size={15} style={{ color: '#7d7d85' }} />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Buscar nota..."
            className="flex-1 bg-transparent text-[13.5px] text-zinc-100 outline-none placeholder-zinc-600"
            style={{ boxShadow: 'none' }}
          />
          <kbd
            style={{
              fontSize: '10px',
              color: '#6d6d75',
              border: '1px solid #353535',
              borderRadius: 4,
              padding: '1px 5px',
              backgroundColor: '#1a1a1a',
            }}
          >
            Esc
          </kbd>
        </div>

        <div className="max-h-[340px] overflow-y-auto p-1.5">
          {filtered.length === 0 ? (
            <div className="px-4 py-6 text-center text-[13px] text-zinc-600">
              Nenhuma nota encontrada
            </div>
          ) : (
            filtered.map((note, i) => {
              const section = getSectionForNote(note.task_id)
              return (
                <button
                  key={note.id}
                  onClick={() => handleSelect(note.id)}
                  onMouseEnter={() => setSelectedIndex(i)}
                  className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors"
                  style={{ backgroundColor: i === selectedIndex ? '#2a2a2a' : 'transparent' }}
                >
                  <FileText size={14} style={{ color: '#6d6d75', flexShrink: 0 }} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[13px] text-zinc-200">{note.title || 'Sem título'}</div>
                    {note.content && (
                      <div className="mt-0.5 truncate text-[11px] text-zinc-600">
                        {note.content.slice(0, 80)}
                      </div>
                    )}
                  </div>
                  {section && (
                    <div className="flex flex-shrink-0 items-center gap-1.5">
                      <span className="h-2 w-2 rounded-full" style={{ backgroundColor: section.color }} />
                      <span className="text-[11px] text-zinc-500">
                        {sectionDisplayLabel(section.key_suffix, section.label)}
                      </span>
                    </div>
                  )}
                </button>
              )
            })
          )}
        </div>
      </div>
    </div>
  )
}
