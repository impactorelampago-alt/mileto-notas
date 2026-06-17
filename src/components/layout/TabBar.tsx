import { useMemo, useRef, useState, useEffect } from 'react'
import { motion } from 'framer-motion'
import { Check, CheckCircle2, Pin, Plus, Users, X, LogOut } from 'lucide-react'
import { useNotesStore } from '../../stores/notes-store'
import { useOpsStore, SYSTEM_SUFFIXES } from '../../stores/ops-store'
import { useAuthStore } from '../../stores/auth-store'
import { useUIStore } from '../../stores/ui-store'
import { useSharingStore } from '../../stores/sharing-store'
import { NOTE_PRIORITY_COLORS, NOTE_PRIORITY_LABELS, normalizePriority } from '../../lib/note-priority'
import { isDoneStatus, getStatusBase } from '../../lib/status-keys'
import type { NotePriority } from '../../lib/types'

type SectionGroup = {
  key: string
  label: string
  color: string
  noteIds: string[]
}

// Ordem do seletor (mais urgente no topo, como no Mileto Ops)
const PRIORITY_PICK_ORDER: NotePriority[] = ['URGENT', 'HIGH', 'MEDIUM', 'LOW']

/**
 * Barra de abas estilo Bloco de Notas do Windows 11 — refinada. Abas da
 * categoria ativa; nota nova entra a direita. Bolinha = urgencia (sincronizada
 * com o Mileto Ops); clicar abre o seletor de urgencia. Duplo-clique no titulo renomeia.
 */
export default function TabBar() {
  const {
    activeTabId,
    notes,
    setActiveTab,
    openTab,
    createNote,
    noteIdsWithCollaborators,
    deleteNote,
    updateNote,
    toggleComplete,
    completedOrigins,
  } = useNotesStore()
  const sections = useOpsStore((s) => s.sections)
  const activeSectionId = useOpsStore((s) => s.activeSectionId)
  const tasks = useOpsStore((s) => s.tasks)
  const signOut = useAuthStore((s) => s.signOut)
  const canDeleteNote = useAuthStore((s) => s.canDeleteNote)
  const canEditNote = useAuthStore((s) => s.canEditNote)
  useAuthStore((s) => s.editableIds) // re-render quando os conjuntos de permissão chegam
  const viewAll = useAuthStore((s) => s.viewAll)
  const noteShares = useSharingStore((s) => s.noteShares)
  const setSharePickerTarget = useUIStore((s) => s.setSharePickerTarget)

  const [hoveredTab, setHoveredTab] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [renamingNoteId, setRenamingNoteId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [contextMenuNoteId, setContextMenuNoteId] = useState<string | null>(null)
  const [contextMenuPos, setContextMenuPos] = useState({ x: 0, y: 0 })
  const [priorityMenu, setPriorityMenu] = useState<{ noteId: string; x: number; y: number } | null>(null)

  const renameInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (renamingNoteId) setTimeout(() => renameInputRef.current?.select(), 0)
  }, [renamingNoteId])

  useEffect(() => {
    if (!contextMenuNoteId) return
    const close = () => setContextMenuNoteId(null)
    window.addEventListener('click', close)
    return () => window.removeEventListener('click', close)
  }, [contextMenuNoteId])

  useEffect(() => {
    if (!priorityMenu) return
    const close = () => setPriorityMenu(null)
    window.addEventListener('click', close)
    return () => window.removeEventListener('click', close)
  }, [priorityMenu])

  const taskToSectionMap = useMemo(() => {
    const map = new Map<string, string>()
    for (const task of tasks) {
      // Nota concluída fica na categoria de ORIGEM (guardada localmente), não no
      // DONE — assim ela não "some" da categoria ao concluir, só fica marcada.
      const effStatus =
        isDoneStatus(task.status) && completedOrigins[task.id]
          ? completedOrigins[task.id]
          : task.status
      let section
      if (viewAll) {
        // No modo "Todos" as seções são únicas por SUFIXO (agregadas de toda a
        // equipe) → casa pelo sufixo, agregando o "Lembrete" de todo mundo etc.
        section = sections.find((item) => item.key_suffix === getStatusBase(effStatus))
      } else {
        // 1) Casamento exato pela key completa: categorias próprias (custom) e compartilhadas.
        section = sections.find((item) => effStatus === item.key)
        // 2) Fallback p/ categorias de SISTEMA (ex.: Lembrete/TODO): a section.key é
        //    deduplicada por rótulo e pode ser a key de outro usuário, mas a task
        //    carrega o MEU `USR_<id>_SUFIXO`. Casa pelo sufixo, só entre sufixos de sistema.
        if (!section) {
          const base = getStatusBase(effStatus)
          if (SYSTEM_SUFFIXES.has(base)) {
            section = sections.find((item) => item.key_suffix === base)
          }
        }
      }
      if (section) map.set(task.id, section.key_suffix)
    }
    return map
  }, [tasks, sections, completedOrigins, viewAll])

  const sectionGroups = useMemo<SectionGroup[]>(() => {
    const groups = new Map<string, SectionGroup>()
    for (const section of sections) {
      groups.set(section.key_suffix, { key: section.key_suffix, label: section.label, color: section.color, noteIds: [] })
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

  // Ordena as abas por criacao crescente: nota nova entra a DIREITA, antigas a esquerda.
  const orderedNoteIds = useMemo(() => {
    if (!activeGroup) return []
    return [...activeGroup.noteIds].sort((a, b) => {
      const ca = notes.find((n) => n.id === a)?.created_at ?? ''
      const cb = notes.find((n) => n.id === b)?.created_at ?? ''
      return ca < cb ? -1 : ca > cb ? 1 : 0
    })
  }, [activeGroup, notes])

  const startRename = (noteId: string, currentTitle: string) => {
    setRenamingNoteId(noteId)
    setRenameValue(currentTitle === 'Sem título' ? '' : currentTitle)
    setContextMenuNoteId(null)
  }

  const confirmRename = async (noteId: string) => {
    const title = renameValue.trim()
    if (title) await updateNote(noteId, { title })
    setRenamingNoteId(null)
    setRenameValue('')
  }

  const handleCreateNote = async () => {
    if (isSubmitting || !activeSectionId) return
    setIsSubmitting(true)
    try {
      await createNote({ title: 'Sem título', categoryId: null, sectionSuffix: activeSectionId })
    } catch (err) {
      console.error('[TabBar] createNote failed:', err)
    } finally {
      setIsSubmitting(false)
    }
  }

  // Garante que a categoria ativa NUNCA fique sem nota: se está vazia, cria uma
  // em branco. Uma tentativa por categoria (não entra em loop se falhar). Espera
  // 400ms (deixa o boot criar primeiro, evita nota duplicada). Não cria em
  // impersonação (visualizando outra conta).
  const ensuredSectionRef = useRef<string | null>(null)
  useEffect(() => {
    if (!activeGroup || !activeSectionId) return
    if (orderedNoteIds.length > 0) {
      ensuredSectionRef.current = null
      return
    }
    if (useAuthStore.getState().viewingAs || useAuthStore.getState().viewAll) return
    const sectionKey = activeGroup.key
    if (ensuredSectionRef.current === sectionKey) return
    const t = setTimeout(() => {
      ensuredSectionRef.current = sectionKey
      void createNote({ title: 'Sem título', categoryId: null, sectionSuffix: activeSectionId }).catch((e) =>
        console.error('[TabBar] auto-criar nota vazia:', e),
      )
    }, 400)
    return () => clearTimeout(t)
  }, [activeGroup, orderedNoteIds.length, activeSectionId, createNote])

  return (
    <div
      className="flex items-stretch"
      style={{ backgroundColor: '#1a1a1a', borderBottom: '1px solid #2a2a2a', height: 38 }}
    >
      <div className="tabs-container flex flex-1 items-stretch overflow-x-auto">
        {activeGroup ? (
          <>
            {orderedNoteIds.map((noteId) => {
              const note = notes.find((item) => item.id === noteId)
              if (!note) return null

              const isActive = noteId === activeTabId
              const isHovered = noteId === hoveredTab
              const priority = normalizePriority(note.priority)
              const priorityColors = NOTE_PRIORITY_COLORS[priority]
              const noteTask = tasks.find((t) => t.id === note.task_id)
              const isDone = noteTask ? isDoneStatus(noteTask.status) : false
              const canComplete = !viewAll && !!note.task_id && !(note.is_shared_with_me && note.shared_permission !== 'EDIT')
              // Posso editar esta nota? (mesma regra do Editor) — gateia o dot de
              // prioridade e o renomear, que escrevem na task/nota de terceiros.
              const editable = !viewAll && canEditNote(note)

              return (
                <div
                  key={noteId}
                  onClick={() => { openTab(noteId); setActiveTab(noteId) }}
                  onDoubleClick={() => { if (editable) startRename(noteId, note.title) }}
                  onMouseEnter={() => setHoveredTab(noteId)}
                  onMouseLeave={() => setHoveredTab(null)}
                  onContextMenu={(e) => {
                    e.preventDefault()
                    e.stopPropagation()
                    if (viewAll) return
                    setContextMenuPos({ x: e.clientX, y: e.clientY })
                    setContextMenuNoteId(noteId)
                  }}
                  className="relative flex items-center"
                  style={{
                    gap: 8,
                    padding: '0 14px',
                    minWidth: 132,
                    maxWidth: 210,
                    cursor: 'pointer',
                    backgroundColor: isActive ? '#2d2d2d' : isHovered ? '#222222' : 'transparent',
                    borderRight: isActive ? '1px solid transparent' : '1px solid #2a2a2a',
                    borderTopLeftRadius: 8,
                    borderTopRightRadius: 8,
                    boxShadow: isActive ? '0 -1px 4px rgba(0,0,0,0.2)' : 'none',
                    transition: 'background-color 140ms',
                  }}
                  title="Duplo-clique para renomear"
                >
                  {isActive && (
                    <motion.span
                      layoutId="activeTabStripe"
                      transition={{ type: 'spring', stiffness: 320, damping: 30 }}
                      style={{
                        position: 'absolute',
                        top: 0,
                        left: 0,
                        right: 0,
                        height: 2,
                        backgroundColor: priorityColors.dot,
                        borderTopLeftRadius: 8,
                        borderTopRightRadius: 8,
                      }}
                    />
                  )}

                  <motion.span
                    whileTap={editable ? { scale: 1.3 } : undefined}
                    onClick={(e) => {
                      e.stopPropagation()
                      if (!editable) return // só indicador visual quando não posso editar
                      const r = e.currentTarget.getBoundingClientRect()
                      setPriorityMenu({ noteId, x: r.left - 6, y: r.bottom + 8 })
                    }}
                    title={editable ? `Urgência: ${NOTE_PRIORITY_LABELS[priority]} (clique para trocar)` : `Urgência: ${NOTE_PRIORITY_LABELS[priority]}`}
                    style={{ width: 9, height: 9, borderRadius: 999, backgroundColor: priorityColors.dot, flexShrink: 0, cursor: editable ? 'pointer' : 'default' }}
                  />

                  {note.is_pinned && <Pin size={10} style={{ color: '#10b981', flexShrink: 0 }} />}

                  {renamingNoteId === noteId ? (
                    <input
                      ref={renameInputRef}
                      value={renameValue}
                      onChange={(e) => setRenameValue(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') void confirmRename(noteId)
                        if (e.key === 'Escape') { setRenamingNoteId(null); setRenameValue('') }
                        e.stopPropagation()
                      }}
                      onBlur={() => void confirmRename(noteId)}
                      onClick={(e) => e.stopPropagation()}
                      className="min-w-0 flex-1 bg-transparent text-[12.5px] outline-none"
                      style={{ color: '#f4f4f5' }}
                      placeholder="Nome da nota..."
                    />
                  ) : (
                    <span
                      className="flex-1 truncate text-[12.5px]"
                      style={{
                        color: isDone ? '#6b6b72' : isActive ? '#f4f4f5' : '#9a9aa3',
                        fontWeight: isActive ? 500 : 400,
                        textDecoration: isDone ? 'line-through' : 'none',
                      }}
                    >
                      {note.title || 'Sem título'}
                    </span>
                  )}

                  {(noteIdsWithCollaborators.has(noteId) || (noteShares[noteId]?.length ?? 0) > 0 || note.is_shared_with_me) && (
                    <Users size={10} style={{ color: '#34d399', flexShrink: 0 }} />
                  )}

                  {/* ✓ Concluir/Reabrir na própria aba (toggle). Cinza = pendente, verde = concluída.
                     A nota NÃO sai da categoria — só muda de cor (e risca o título). */}
                  {canComplete && (
                    <span
                      onClick={(e) => { e.stopPropagation(); void toggleComplete(noteId) }}
                      title={isDone ? 'Concluída — clique para reabrir' : 'Concluir'}
                      className="flex shrink-0 items-center justify-center"
                      style={{
                        width: 18, height: 18, borderRadius: 4,
                        color: isDone ? '#34d399' : '#71717a',
                        backgroundColor: isDone ? 'rgba(16,185,129,0.14)' : 'transparent',
                        transition: 'background-color 140ms, color 140ms',
                      }}
                      onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = 'rgba(16,185,129,0.22)'; e.currentTarget.style.color = '#34d399' }}
                      onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = isDone ? 'rgba(16,185,129,0.14)' : 'transparent'; e.currentTarget.style.color = isDone ? '#34d399' : '#71717a' }}
                    >
                      <Check size={12} strokeWidth={2.5} style={{ opacity: isDone || isActive || isHovered ? 1 : 0, transition: 'opacity 140ms' }} />
                    </span>
                  )}

                  {!viewAll && canDeleteNote(note) && (
                    <span
                      onClick={(e) => { e.stopPropagation(); void deleteNote(noteId) }}
                      title="Excluir nota"
                      className="flex shrink-0 items-center justify-center"
                      style={{ width: 18, height: 18, borderRadius: 4, color: '#71717a', transition: 'background-color 140ms, color 140ms' }}
                      onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = 'rgba(239,68,68,0.12)'; e.currentTarget.style.color = '#ef4444' }}
                      onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; e.currentTarget.style.color = '#71717a' }}
                    >
                      <X size={11} style={{ opacity: isActive || isHovered ? 1 : 0, transition: 'opacity 140ms' }} />
                    </span>
                  )}
                </div>
              )
            })}

            {!viewAll && (
              <button
                onClick={() => void handleCreateNote()}
                disabled={isSubmitting}
                className="flex shrink-0 items-center justify-center"
                style={{
                  width: 32,
                  height: 32,
                  alignSelf: 'center',
                  marginLeft: 6,
                  borderRadius: 6,
                  color: '#71717a',
                  backgroundColor: 'transparent',
                  transition: 'background-color 140ms, color 140ms, transform 90ms',
                }}
                onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = '#232323'; e.currentTarget.style.color = '#d4d4d8' }}
                onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; e.currentTarget.style.color = '#71717a' }}
                onMouseDown={(e) => { e.currentTarget.style.transform = 'scale(0.92)' }}
                onMouseUp={(e) => { e.currentTarget.style.transform = 'scale(1)' }}
                title="Nova nota"
              >
                <Plus size={16} />
              </button>
            )}
          </>
        ) : (
          <div className="flex items-center" style={{ padding: '0 16px', color: '#52525b', fontSize: '12px' }}>
            Escolha uma categoria no topo
          </div>
        )}
      </div>

      {/* Divisor estrutural + chip "Sair" */}
      <div style={{ width: 1, height: 16, alignSelf: 'center', backgroundColor: '#2a2a2a', margin: '0 8px' }} />
      <button
        onClick={() => void signOut()}
        title="Sair"
        className="flex items-center gap-2"
        style={{
          alignSelf: 'center',
          height: 30,
          padding: '0 12px',
          marginRight: 8,
          borderRadius: 6,
          color: '#8a8a92',
          fontSize: 12,
          fontWeight: 500,
          backgroundColor: 'transparent',
          transition: 'background-color 140ms, color 140ms, transform 90ms',
        }}
        onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = 'rgba(239,68,68,0.1)'; e.currentTarget.style.color = '#ef4444' }}
        onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; e.currentTarget.style.color = '#8a8a92' }}
        onMouseDown={(e) => { e.currentTarget.style.transform = 'scale(0.97)' }}
        onMouseUp={(e) => { e.currentTarget.style.transform = 'scale(1)' }}
      >
        <LogOut size={14} />
        Sair
      </button>

      {/* Seletor de urgência (sincronizado com o Mileto Ops) */}
      {priorityMenu && (() => {
        const note = notes.find((n) => n.id === priorityMenu.noteId)
        const current = note ? normalizePriority(note.priority) : 'LOW'
        return (
          <div
            className="fixed z-50 overflow-hidden rounded-[10px] border"
            style={{ left: priorityMenu.x, top: priorityMenu.y, backgroundColor: '#202020', borderColor: '#353535', boxShadow: '0 8px 24px rgba(0,0,0,0.45)', minWidth: 168, padding: 4 }}
            onClick={(e) => e.stopPropagation()}
          >
            {PRIORITY_PICK_ORDER.map((p) => {
              const c = NOTE_PRIORITY_COLORS[p]
              const isCurrent = p === current
              return (
                <button
                  key={p}
                  onClick={() => { const id = priorityMenu.noteId; setPriorityMenu(null); void updateNote(id, { priority: p }) }}
                  className="flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left"
                  style={{ backgroundColor: isCurrent ? '#2a2a2a' : 'transparent', transition: 'background-color 120ms' }}
                  onMouseEnter={(e) => { if (!isCurrent) e.currentTarget.style.backgroundColor = '#2a2a2a' }}
                  onMouseLeave={(e) => { if (!isCurrent) e.currentTarget.style.backgroundColor = 'transparent' }}
                >
                  <span style={{ width: 10, height: 10, borderRadius: 999, backgroundColor: c.dot, flexShrink: 0 }} />
                  <span className="flex-1" style={{ color: '#e7e7ea', fontSize: '12.5px' }}>{NOTE_PRIORITY_LABELS[p]}</span>
                  {isCurrent && <Check size={13} style={{ color: '#10b981' }} />}
                </button>
              )
            })}
          </div>
        )
      })()}

      {contextMenuNoteId && (() => {
        const ctxNote = notes.find((n) => n.id === contextMenuNoteId)
        if (!ctxNote) return null
        const ownsNote = canDeleteNote(ctxNote)
        const canRename = canEditNote(ctxNote)
        const canShare = ownsNote
        const canComplete = !!ctxNote.task_id && !(ctxNote.is_shared_with_me && ctxNote.shared_permission !== 'EDIT')
        const ctxTask = tasks.find((t) => t.id === ctxNote.task_id)
        const ctxDone = ctxTask ? isDoneStatus(ctxTask.status) : false
        return (
          <div
            className="fixed z-50 overflow-hidden rounded-[10px] border"
            style={{
              left: contextMenuPos.x,
              top: contextMenuPos.y,
              backgroundColor: '#202020',
              borderColor: '#353535',
              boxShadow: '0 8px 24px rgba(0,0,0,0.45)',
              minWidth: 156,
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {canComplete && (
              <button
                onClick={() => {
                  const id = contextMenuNoteId
                  setContextMenuNoteId(null)
                  if (id) void toggleComplete(id)
                }}
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-[12.5px] transition-colors hover:bg-zinc-800"
                style={{ color: '#6ee7b7' }}
              >
                <CheckCircle2 size={13} style={{ color: '#34d399' }} /> {ctxDone ? 'Reabrir' : 'Concluir'}
              </button>
            )}
            {canRename && (
              <button
                onClick={() => startRename(ctxNote.id, ctxNote.title)}
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-[12.5px] text-zinc-200 transition-colors hover:bg-zinc-800"
              >
                Renomear
              </button>
            )}
            {canShare && (
              <button
                onClick={() => {
                  setContextMenuNoteId(null)
                  setSharePickerTarget({ kind: 'note', id: ctxNote.id, label: ctxNote.title })
                }}
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-[12.5px] text-zinc-200 transition-colors hover:bg-zinc-800"
              >
                <Users size={13} style={{ color: '#34d399' }} /> Compartilhar com…
              </button>
            )}
            {ownsNote && (
              <button
                onClick={() => {
                  const id = contextMenuNoteId
                  setContextMenuNoteId(null)
                  if (id) void deleteNote(id)
                }}
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-[12.5px] text-red-400 transition-colors hover:bg-zinc-800"
              >
                Excluir
              </button>
            )}
          </div>
        )
      })()}
    </div>
  )
}
