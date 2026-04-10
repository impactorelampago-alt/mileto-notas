import { useState, useEffect, useRef } from 'react'
import { Search } from 'lucide-react'
import { useOpsStore } from '../../stores/ops-store'
import { useNotesStore } from '../../stores/notes-store'
import { supabase } from '../../lib/supabase'

interface QuickSearchProps {
  onClose: () => void
}

export function QuickSearch({ onClose }: QuickSearchProps) {
  const [query, setQuery] = useState('')
  const { tasks, sections } = useOpsStore()
  const { openTab, fetchNoteById, closeAllTabs } = useNotesStore()
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [onClose])

  const filteredTasks = query.trim().length < 1
    ? tasks.slice(0, 10)
    : tasks.filter(t =>
        t.title.toLowerCase().includes(query.toLowerCase())
      ).slice(0, 15)

  const getSectionColor = (status: string): string => {
    const section = sections.find(s => status.endsWith(s.key_suffix))
    return section?.color ?? '#52525b'
  }

  const getSectionLabel = (status: string): string => {
    const section = sections.find(s => status.endsWith(s.key_suffix))
    return section?.label ?? ''
  }

  const handleSelectTask = async (taskId: string) => {
    onClose()
    closeAllTabs()

    const { data } = await supabase
      .from('notes')
      .select('id')
      .eq('task_id', taskId)
      .maybeSingle()

    if (data) {
      await fetchNoteById(data.id)
      openTab(data.id)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-24"
      style={{ backgroundColor: 'rgba(0,0,0,0.6)' }}
      onClick={onClose}
    >
      <div
        className="w-[560px] rounded-lg shadow-2xl overflow-hidden"
        style={{ backgroundColor: '#111111', border: '1px solid #1f2f1f' }}
        onClick={e => e.stopPropagation()}
      >
        {/* Input */}
        <div className="flex items-center gap-2 px-4 py-3" style={{ borderBottom: '1px solid #1a2a1a' }}>
          <Search size={14} className="text-zinc-500 flex-shrink-0" />
          <input
            ref={inputRef}
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Buscar tarefa..."
            className="flex-1 bg-transparent text-[13px] text-zinc-200 outline-none placeholder-zinc-600"
          />
          <kbd className="text-[10px] text-zinc-600 px-1.5 py-0.5 rounded" style={{ border: '1px solid #2a2a2a' }}>ESC</kbd>
        </div>

        {/* Resultados */}
        <div className="max-h-[320px] overflow-y-auto">
          {filteredTasks.length === 0 ? (
            <div className="px-4 py-3 text-[12px] text-zinc-600">Nenhuma tarefa encontrada</div>
          ) : (
            filteredTasks.map(task => (
              <button
                key={task.id}
                onClick={() => void handleSelectTask(task.id)}
                className="flex items-center gap-3 w-full px-4 py-2.5 text-left hover:bg-zinc-800 transition-colors"
              >
                <span
                  className="w-2 h-2 rounded-full flex-shrink-0"
                  style={{ backgroundColor: getSectionColor(task.status) }}
                />
                <span className="text-[12px] text-zinc-200 flex-1 truncate">{task.title}</span>
                <span className="text-[10px] text-zinc-600 flex-shrink-0">{getSectionLabel(task.status)}</span>
              </button>
            ))
          )}
        </div>

        {/* Footer */}
        <div className="px-4 py-2 flex gap-4 text-[10px] text-zinc-600" style={{ borderTop: '1px solid #1a2a1a' }}>
          <span>↵ abrir nota</span>
          <span>ESC fechar</span>
        </div>
      </div>
    </div>
  )
}
