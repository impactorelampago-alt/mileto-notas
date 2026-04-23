import { useState, useRef, useEffect, useMemo } from 'react'
import { Search, FileText } from 'lucide-react'
import { useNotesStore } from '../../stores/notes-store'
import { useOpsStore } from '../../stores/ops-store'
import { useUIStore } from '../../stores/ui-store'

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
      // Navegar para a seção da tarefa (mesmo comportamento do clique no MenuBar)
      setActiveSectionId(section.key_suffix)

      // Fechar abas da seção anterior
      const { openTabs, closeTab } = useNotesStore.getState()
      ;[...openTabs].forEach((tabId) => closeTab(tabId))

      // Abrir todas as notas da seção destino
      const { tasks: allTasks } = useOpsStore.getState()
      const sectionTasks = allTasks.filter((t) => t.status.endsWith(section.key_suffix))
      const taskIds = new Set(sectionTasks.map((t) => t.id))
      const sectionNotes = notes.filter((n) => n.task_id !== null && taskIds.has(n.task_id))

      for (const sNote of sectionNotes) {
        openTab(sNote.id)
      }

      // Garantir que a nota selecionada fique ativa
      useNotesStore.getState().setActiveTab(noteId)
    } else {
      // Nota avulsa (sem task_id) — só abre a aba
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
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-[15vh]"
      style={{ backgroundColor: 'rgba(0, 0, 0, 0.6)' }}
      onClick={() => setShowQuickSearch(false)}
    >
      <div
        className="w-[500px] rounded-lg overflow-hidden shadow-2xl"
        style={{ backgroundColor: '#1e1e1e', border: '1px solid #333' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 px-4 py-3" style={{ borderBottom: '1px solid #333' }}>
          <Search size={16} style={{ color: '#666' }} />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Buscar nota..."
            className="flex-1 bg-transparent text-[14px] text-zinc-100 outline-none placeholder-zinc-600"
          />
        </div>

        <div className="max-h-[300px] overflow-y-auto">
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
                  className="flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors"
                  style={{
                    backgroundColor: i === selectedIndex ? '#2a2a2a' : 'transparent',
                  }}
                >
                  <FileText size={14} style={{ color: '#555', flexShrink: 0 }} />
                  <div className="flex-1 min-w-0">
                    <div className="text-[13px] text-zinc-200 truncate">{note.title}</div>
                    {note.content && (
                      <div className="text-[11px] text-zinc-600 truncate mt-0.5">
                        {note.content.slice(0, 80)}
                      </div>
                    )}
                  </div>
                  {section && (
                    <div className="flex items-center gap-1.5 flex-shrink-0">
                      <span
                        className="w-2 h-2 rounded-full"
                        style={{ backgroundColor: section.color }}
                      />
                      <span className="text-[11px] text-zinc-500">{section.label}</span>
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
