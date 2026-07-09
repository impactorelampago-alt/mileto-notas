import { useMemo, useRef, useState } from 'react'
import {
  ArrowLeftRight,
  FileText,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
  Plus,
  X,
} from 'lucide-react'
import { useNotesStore } from '../../stores/notes-store'
import { useAuthStore } from '../../stores/auth-store'
import { useUIStore, SUBNOTE_MIN_WIDTH, SUBNOTE_MAX_WIDTH } from '../../stores/ui-store'
import { NOTE_PRIORITY_COLORS, normalizePriority } from '../../lib/note-priority'

export default function SubnoteTree() {
  const notes = useNotesStore((s) => s.notes)
  const activeTabId = useNotesStore((s) => s.activeTabId)
  const openTab = useNotesStore((s) => s.openTab)
  const setActiveTab = useNotesStore((s) => s.setActiveTab)
  const createSubnote = useNotesStore((s) => s.createSubnote)
  const reorderSubnotes = useNotesStore((s) => s.reorderSubnotes)
  const deleteNote = useNotesStore((s) => s.deleteNote)

  // Permissão da RAIZ define quem pode criar/excluir subnota (a subnota herda o
  // contexto de permissão da nota raiz). DONO tem controle total; modo "Todos" e
  // impersonação são só-leitura; caso contrário vale canEditNote.
  const viewAll = useAuthStore((s) => s.viewAll)
  const viewingAs = useAuthStore((s) => s.viewingAs)
  useAuthStore((s) => s.editableIds) // re-render quando os conjuntos de permissão chegam
  const canEditNote = useAuthStore((s) => s.canEditNote)
  const isDono = useAuthStore((s) => s.isDono())

  // Preferências do painel (lado / colapsado / largura), persistidas no ui-store.
  const side = useUIStore((s) => s.subnoteSide)
  const collapsed = useUIStore((s) => s.subnoteCollapsed)
  const width = useUIStore((s) => s.subnoteWidth)
  const toggleSide = useUIStore((s) => s.toggleSubnoteSide)
  const toggleCollapsed = useUIStore((s) => s.toggleSubnoteCollapsed)
  const setWidth = useUIStore((s) => s.setSubnoteWidth)
  const openConfirm = useUIStore((s) => s.openConfirm)

  const [hoveredNoteId, setHoveredNoteId] = useState<string | null>(null)
  const [dragId, setDragId] = useState<string | null>(null)
  const [overId, setOverId] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [dragWidth, setDragWidth] = useState<number | null>(null)
  const dragRef = useRef<number | null>(null)

  const activeNote = useMemo(
    () => notes.find((note) => note.id === activeTabId) ?? null,
    [activeTabId, notes],
  )

  // Nota raiz: a própria nota se for raiz, senão a nota apontada por parent_note_id.
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

  const canEditRoot = rootNote ? !viewingAs && (isDono || (!viewAll && canEditNote(rootNote))) : false

  if (!activeNote || !rootNote) return null
  // Só-leitura sem nenhuma subnota: painel vazio não agrega — esconde. Quando há
  // subnotas, o painel continua visível para o viewer NAVEGAR entre elas.
  if (subnotes.length === 0 && !canEditRoot) return null

  const openNote = (noteId: string) => {
    openTab(noteId)
    setActiveTab(noteId)
  }

  // Arrastar pra reordenar (grava notes.position na nova ordem).
  const handleReorderDrop = (targetId: string) => {
    setOverId(null)
    const src = dragId
    setDragId(null)
    if (!src || src === targetId) return
    const ids = subnotes.map((n) => n.id)
    const from = ids.indexOf(src)
    const to = ids.indexOf(targetId)
    if (from < 0 || to < 0) return
    ids.splice(from, 1)
    ids.splice(to, 0, src)
    void reorderSubnotes(ids)
  }

  // Cria a subnota já e abre — SEM pedir título. O título vem da 1ª linha do
  // conteúdo (auto-título do Editor); o usuário edita a 1ª linha pra renomear.
  const handleCreate = async () => {
    if (isSubmitting || !canEditRoot) return
    setIsSubmitting(true)
    try {
      await createSubnote(rootNote.id, { title: 'Sem título' })
    } finally {
      setIsSubmitting(false)
    }
  }

  const rootActive = activeNote.id === rootNote.id
  const sideBorder = side === 'left'
    ? { borderRight: '1px solid #333333' }
    : { borderLeft: '1px solid #333333' }

  // COLAPSADO: faixa fina que vira uma MINI-NAVEGAÇÃO — raiz + subnotas como ícones
  // clicáveis (ativa destacada, título no hover), pra alternar rápido sem expandir.
  if (collapsed) {
    const OpenIcon = side === 'left' ? PanelLeftOpen : PanelRightOpen
    return (
      <aside
        className="flex shrink-0 flex-col items-center"
        style={{ width: 38, backgroundColor: '#252526', paddingTop: 6, ...sideBorder }}
      >
        <button
          onClick={toggleCollapsed}
          className="flex h-7 w-7 items-center justify-center rounded transition-colors hover:bg-zinc-800"
          style={{ color: '#a1a1aa' }}
          title="Expandir subnotas"
        >
          <OpenIcon size={15} />
        </button>
        <div style={{ width: 18, height: 1, backgroundColor: '#333333', margin: '5px 0 6px' }} />

        <div className="no-scrollbar flex min-h-0 flex-1 flex-col items-center gap-1 overflow-y-auto" style={{ paddingBottom: 8 }}>
          {/* Nota raiz */}
          <button
            onClick={() => openNote(rootNote.id)}
            className="flex h-7 w-7 items-center justify-center rounded-md transition-colors hover:bg-zinc-800"
            style={{
              backgroundColor: rootActive ? '#163126' : 'transparent',
              border: `1px solid ${rootActive ? '#245642' : 'transparent'}`,
            }}
            title={rootNote.title || 'Sem título'}
          >
            <span
              style={{ width: 8, height: 8, borderRadius: 999, backgroundColor: rootActive ? '#10b981' : '#71717a' }}
            />
          </button>

          {/* Subnotas */}
          {subnotes.map((note) => {
            const isActive = activeNote.id === note.id
            const prColor = NOTE_PRIORITY_COLORS[normalizePriority(note.priority)].dot
            return (
              <button
                key={note.id}
                onClick={() => openNote(note.id)}
                className="flex h-7 w-7 items-center justify-center rounded-md transition-colors hover:bg-zinc-800"
                style={{
                  backgroundColor: isActive ? '#163126' : 'transparent',
                  border: `1px solid ${isActive ? '#245642' : 'transparent'}`,
                }}
                title={note.title || 'Sem título'}
              >
                <FileText size={13} style={{ color: prColor }} />
              </button>
            )
          })}

          {canEditRoot && (
            <button
              onClick={() => void handleCreate()}
              disabled={isSubmitting}
              className="mt-0.5 flex h-7 w-7 items-center justify-center rounded-md transition-colors hover:bg-zinc-800 disabled:opacity-40"
              style={{ color: '#71717a' }}
              title="Nova subnota"
            >
              <Plus size={14} />
            </button>
          )}
        </div>
      </aside>
    )
  }

  const effWidth = dragWidth ?? width
  const CloseIcon = side === 'left' ? PanelLeftClose : PanelRightClose

  // Redimensiona arrastando a alça na borda interna (estilo VS Code). Atualiza uma
  // largura local durante o arraste (fluido) e persiste no ui-store ao soltar.
  const startResize = (e: React.MouseEvent) => {
    e.preventDefault()
    const startX = e.clientX
    const startW = effWidth
    const onMove = (ev: MouseEvent) => {
      const delta = side === 'left' ? ev.clientX - startX : startX - ev.clientX
      const next = Math.min(SUBNOTE_MAX_WIDTH, Math.max(SUBNOTE_MIN_WIDTH, startW + delta))
      dragRef.current = next
      setDragWidth(next)
    }
    const onUp = () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      if (dragRef.current != null) setWidth(dragRef.current)
      dragRef.current = null
      setDragWidth(null)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
  }

  return (
    <aside
      className="relative flex shrink-0 flex-col"
      style={{ width: effWidth, backgroundColor: '#252526', ...sideBorder }}
    >
      <div
        className="flex h-9 items-center justify-between"
        style={{ padding: '0 6px 0 10px', borderBottom: '1px solid #333333' }}
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
        <div className="flex shrink-0 items-center gap-0.5">
          <button
            onClick={toggleSide}
            className="flex h-6 w-6 items-center justify-center rounded transition-colors hover:bg-zinc-800"
            style={{ color: '#71717a' }}
            title={side === 'left' ? 'Mover para a direita' : 'Mover para a esquerda'}
          >
            <ArrowLeftRight size={13} />
          </button>
          {canEditRoot && (
            <button
              onClick={() => void handleCreate()}
              disabled={isSubmitting}
              className="flex h-6 w-6 items-center justify-center rounded transition-colors hover:bg-zinc-800 disabled:opacity-40"
              style={{ color: '#a1a1aa' }}
              title="Nova subnota"
            >
              <Plus size={14} />
            </button>
          )}
          <button
            onClick={toggleCollapsed}
            className="flex h-6 w-6 items-center justify-center rounded transition-colors hover:bg-zinc-800"
            style={{ color: '#71717a' }}
            title="Esconder subnotas"
          >
            <CloseIcon size={14} />
          </button>
        </div>
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
          title={rootNote.title || 'Sem título'}
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
            {rootNote.title || 'Sem título'}
          </span>
        </button>

        <div style={{ marginLeft: 11, borderLeft: '1px solid #3d3d3d', paddingLeft: 9 }}>
          {subnotes.map((note) => {
            const isActive = activeNote.id === note.id
            const isHovered = hoveredNoteId === note.id
            const prColor = NOTE_PRIORITY_COLORS[normalizePriority(note.priority)].dot

            return (
              <div
                key={note.id}
                className="group flex items-center gap-1"
                draggable={canEditRoot}
                onDragStart={(e) => { setDragId(note.id); e.dataTransfer.effectAllowed = 'move' }}
                onDragOver={(e) => { if (dragId && dragId !== note.id) { e.preventDefault(); setOverId(note.id) } }}
                onDrop={(e) => { e.preventDefault(); handleReorderDrop(note.id) }}
                onDragEnd={() => { setDragId(null); setOverId(null) }}
                onMouseEnter={() => setHoveredNoteId(note.id)}
                onMouseLeave={() => setHoveredNoteId(null)}
                style={{
                  opacity: dragId === note.id ? 0.4 : 1,
                  boxShadow: overId === note.id && dragId !== note.id ? 'inset 0 2px 0 #10b981' : undefined,
                  borderRadius: 6,
                  cursor: canEditRoot ? 'grab' : undefined,
                }}
              >
                <button
                  onClick={() => openNote(note.id)}
                  className="flex min-w-0 flex-1 items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-zinc-800"
                  style={{
                    backgroundColor: isActive ? '#163126' : 'transparent',
                    border: `1px solid ${isActive ? '#245642' : 'transparent'}`,
                    color: isActive ? '#d1fae5' : '#c4c4c7',
                  }}
                  title={note.title || 'Sem título'}
                >
                  <FileText size={12} style={{ color: prColor, flexShrink: 0 }} />
                  <span className="truncate text-[12px]">
                    {note.title || 'Sem título'}
                  </span>
                </button>

                {canEditRoot && (isActive || isHovered) && (
                  <button
                    onClick={() => openConfirm({
                      title: 'Excluir subnota',
                      message: 'Excluir esta subnota?\nEsta ação não pode ser desfeita.',
                      confirmLabel: 'Excluir', danger: true,
                      onConfirm: () => { void deleteNote(note.id) },
                    })}
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
        </div>
      </div>

      {/* Alça de redimensionamento na borda interna (entre o painel e o editor). */}
      <div
        onMouseDown={startResize}
        className="group absolute top-0 z-10"
        style={{ bottom: 0, width: 8, cursor: 'col-resize', ...(side === 'left' ? { right: -4 } : { left: -4 }) }}
        title="Arraste para redimensionar"
      >
        <div
          className={`mx-auto h-full transition-colors ${dragWidth != null ? 'bg-emerald-500' : 'group-hover:bg-emerald-500/60'}`}
          style={{ width: 2 }}
        />
      </div>
    </aside>
  )
}
