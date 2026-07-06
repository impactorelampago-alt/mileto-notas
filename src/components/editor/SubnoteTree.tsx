import { useMemo, useState } from 'react'
import { FileText, Plus, X } from 'lucide-react'
import { useNotesStore } from '../../stores/notes-store'

export default function SubnoteTree() {
  const {
    notes,
    activeTabId,
    openTab,
    setActiveTab,
    createSubnote,
    deleteNote,
  } = useNotesStore()

  const [hoveredNoteId, setHoveredNoteId] = useState<string | null>(null)
  const [isCreating, setIsCreating] = useState(false)
  const [draftTitle, setDraftTitle] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)

  const activeNote = useMemo(
    () => notes.find((note) => note.id === activeTabId) ?? null,
    [activeTabId, notes],
  )

  const rootNote = useMemo(() => {
    if (!activeNote) return null
    if (!activeNote.parent_note_id) return activeNote
    return notes.find((note) => note.id === activeNote.parent_note_id) ?? null
  }, [activeNote, notes])

  const subnotes = useMemo(() => {
    if (!rootNote) return []
    return notes
      .filter((note) => note.parent_note_id === rootNote.id)
      .sort((a, b) => a.position - b.position || b.updated_at.localeCompare(a.updated_at))
  }, [notes, rootNote])

  if (!activeNote || !rootNote) return null

  const openNote = (noteId: string) => {
    openTab(noteId)
    setActiveTab(noteId)
  }

  const handleCreate = async () => {
    if (isSubmitting) return
    setIsSubmitting(true)
    try {
      const title = draftTitle.trim() || 'Nova subnota'
      const created = await createSubnote(rootNote.id, { title })
      if (created) {
        setDraftTitle('')
        setIsCreating(false)
      }
    } finally {
      setIsSubmitting(false)
    }
  }

  const rootActive = activeNote.id === rootNote.id

  return (
    <aside
      className="flex w-[236px] shrink-0 flex-col overflow-hidden"
      style={{
        backgroundColor: '#252526',
        borderRight: '1px solid #333333',
      }}
    >
      <div
        className="flex h-9 items-center justify-between"
        style={{ padding: '0 10px', borderBottom: '1px solid #333333' }}
      >
        <div className="flex min-w-0 items-center gap-2">
          <FileText size={13} style={{ color: '#71717a', flexShrink: 0 }} />
          <span className="truncate text-[12px] font-medium" style={{ color: '#d4d4d8' }}>
            Subnotas
          </span>
          <span className="text-[11px]" style={{ color: '#71717a' }}>
            {subnotes.length}
          </span>
        </div>
        <button
          onClick={() => setIsCreating((value) => !value)}
          className="flex h-6 w-6 items-center justify-center rounded transition-colors hover:bg-zinc-800"
          style={{ color: '#a1a1aa' }}
          title="Nova subnota"
        >
          <Plus size={14} />
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto" style={{ padding: '8px 8px 10px' }}>
        <button
          onClick={() => openNote(rootNote.id)}
          className="mb-1 flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-zinc-800"
          style={{
            backgroundColor: rootActive ? '#163126' : 'transparent',
            border: `1px solid ${rootActive ? '#245642' : 'transparent'}`,
            color: rootActive ? '#d1fae5' : '#d4d4d8',
          }}
          title={rootNote.title || 'Sem titulo'}
        >
          <span
            style={{
              width: 7,
              height: 7,
              borderRadius: '999px',
              backgroundColor: rootActive ? '#10b981' : '#71717a',
              flexShrink: 0,
            }}
          />
          <span className="truncate text-[12px] font-medium">
            {rootNote.title || 'Sem titulo'}
          </span>
        </button>

        <div style={{ marginLeft: 11, borderLeft: '1px solid #3d3d3d', paddingLeft: 9 }}>
          {subnotes.map((note) => {
            const isActive = activeNote.id === note.id
            const isHovered = hoveredNoteId === note.id

            return (
              <div
                key={note.id}
                className="group flex items-center gap-1"
                onMouseEnter={() => setHoveredNoteId(note.id)}
                onMouseLeave={() => setHoveredNoteId(null)}
              >
                <button
                  onClick={() => openNote(note.id)}
                  className="flex min-w-0 flex-1 items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-zinc-800"
                  style={{
                    backgroundColor: isActive ? '#163126' : 'transparent',
                    border: `1px solid ${isActive ? '#245642' : 'transparent'}`,
                    color: isActive ? '#d1fae5' : '#c4c4c7',
                  }}
                  title={note.title || 'Sem titulo'}
                >
                  <FileText size={12} style={{ color: isActive ? '#34d399' : '#71717a', flexShrink: 0 }} />
                  <span className="truncate text-[12px]">
                    {note.title || 'Sem titulo'}
                  </span>
                </button>

                {(isActive || isHovered) && (
                  <button
                    onClick={() => void deleteNote(note.id)}
                    className="flex h-6 w-6 shrink-0 items-center justify-center rounded transition-colors hover:bg-zinc-800 hover:text-red-400"
                    style={{ color: '#71717a' }}
                    title="Excluir subnota"
                  >
                    <X size={12} />
                  </button>
                )}
              </div>
            )
          })}

          {isCreating && (
            <div className="mt-1 flex items-center gap-1">
              <input
                value={draftTitle}
                onChange={(event) => setDraftTitle(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') void handleCreate()
                  if (event.key === 'Escape') {
                    setDraftTitle('')
                    setIsCreating(false)
                  }
                }}
                autoFocus
                placeholder="Titulo da subnota"
                className="min-w-0 flex-1 rounded-md border bg-zinc-900 px-2 py-1 text-[12px] outline-none"
                style={{ borderColor: '#3d3d3d', color: '#d4d4d8' }}
              />
              <button
                onClick={() => void handleCreate()}
                disabled={isSubmitting}
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md transition-colors hover:bg-zinc-800 disabled:opacity-40"
                style={{ color: '#34d399' }}
                title="Criar subnota"
              >
                <Plus size={14} />
              </button>
            </div>
          )}
        </div>
      </div>
    </aside>
  )
}
