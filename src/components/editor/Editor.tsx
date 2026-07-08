import { useState, useRef, useCallback, useEffect } from 'react'
import {
  NotebookPen, Bold, Italic, Underline, Strikethrough, Highlighter, Code,
  Heading1, Heading2, List, ListOrdered, ListChecks, Quote, Link2, Minus, Building2, Calendar,
} from 'lucide-react'
import { useNotesStore } from '../../stores/notes-store'
import { useUIStore } from '../../stores/ui-store'
import { useMediaStore } from '../../stores/media-store'
import { useAuthStore } from '../../stores/auth-store'
import AddAnnotationToCompanyModal from '../ui/AddAnnotationToCompanyModal'
import NoteMediaStrip from './NoteMediaStrip'
import NoteDetailBar from './NoteDetailBar'
import SubnoteTree from './SubnoteTree'
import MarkdownEditor, { type MarkdownEditorHandle } from './MarkdownEditor'
import type { FormatKind } from './markdown-cm'

// Título = 1ª linha não-vazia, limpa dos marcadores markdown (fica bonito na aba e
// na task do Ops, que mostra tasks.title).
function deriveTitle(content: string): string {
  const line = content.split('\n').find((l) => l.trim() !== '')?.trim() ?? ''
  if (!line) return ''
  // Os marcadores de bloco casam com espaço OU fim-de-linha, pra que um marcador
  // sozinho ("# ", "- ", "> ") vire título vazio em vez de "#"/"-" enquanto digita.
  return line
    .replace(/^#{1,6}(\s+|$)/, '')
    .replace(/^>(\s+|$)/, '')
    .replace(/^[-*+]\s+\[[ xX]\]\s*/, '')
    .replace(/^[-*+](\s+|$)/, '')
    .replace(/^\d+\.(\s+|$)/, '')
    .replace(/\*\*|__|~~|`|==/g, '')
    .replace(/<\/?u>/g, '')
    .trim()
    .slice(0, 60)
}

type CtxInfo = { x: number; y: number; hasSelection: boolean; text: string; from: number; to: number }

const TOOLBAR: { kind: FormatKind; icon: typeof Bold; title: string; sep?: boolean }[] = [
  { kind: 'bold', icon: Bold, title: 'Negrito (Ctrl+B)' },
  { kind: 'italic', icon: Italic, title: 'Itálico (Ctrl+I)' },
  { kind: 'underline', icon: Underline, title: 'Sublinhado (Ctrl+U)' },
  { kind: 'strike', icon: Strikethrough, title: 'Tachado' },
  { kind: 'highlight', icon: Highlighter, title: 'Marca-texto' },
  { kind: 'code', icon: Code, title: 'Código' },
  { kind: 'h1', icon: Heading1, title: 'Título', sep: true },
  { kind: 'h2', icon: Heading2, title: 'Subtítulo' },
  { kind: 'checklist', icon: ListChecks, title: 'Checklist' },
  { kind: 'ul', icon: List, title: 'Lista' },
  { kind: 'ol', icon: ListOrdered, title: 'Lista numerada' },
  { kind: 'quote', icon: Quote, title: 'Citação' },
  { kind: 'link', icon: Link2, title: 'Link', sep: true },
  { kind: 'divider', icon: Minus, title: 'Divisor' },
]

export default function Editor() {
  const activeNote = useNotesStore((s) => s.notes.find((n) => n.id === s.activeTabId) ?? null)
  const updateNote = useNotesStore((s) => s.updateNote)
  const viewAll = useAuthStore((s) => s.viewAll)
  useAuthStore((s) => s.editableIds) // re-renderiza quando as permissões carregam (canEditNote depende delas)
  const canEditNote = useAuthStore((s) => s.canEditNote)
  const isDono = useAuthStore((s) => s.isDono())
  const { fontSize, showLineNumbers, wordWrap, setCursor, setSaveState } = useUIStore()
  const subnoteSide = useUIStore((s) => s.subnoteSide)

  const [localContent, setLocalContent] = useState(() => activeNote?.content ?? '')
  const [contextMenu, setContextMenu] = useState<CtxInfo | null>(null)
  const [annotationDraft, setAnnotationDraft] = useState<{ text: string; start: number; end: number } | null>(null)
  const [showAnnotationModal, setShowAnnotationModal] = useState(false)
  const editorRef = useRef<MarkdownEditorHandle>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const savedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const localContentRef = useRef<string>(activeNote?.content ?? '')
  const activeNoteIdRef = useRef<string | null>(null)
  activeNoteIdRef.current = activeNote?.id ?? null
  const prevNoteIdRef = useRef<string | null>(activeNote?.id ?? null)

  // Posso EDITAR? (própria/DONO/compartilhada-EDIT/cargo). "Todos" é só-leitura exceto DONO.
  const isReadOnly = !isDono && (viewAll || (!!activeNote && !canEditNote(activeNote)))
  const isReadOnlyRef = useRef(isReadOnly)
  isReadOnlyRef.current = isReadOnly

  // ANTES de trocar de nota, salva o texto (e título=1ª linha) da anterior — o
  // debounce de 500ms é cancelado na troca, senão o recém-digitado some.
  useEffect(() => {
    const prevId = prevNoteIdRef.current
    if (prevId && prevId !== activeNote?.id) {
      const c = localContentRef.current
      const title = deriveTitle(c)
      const patch: { content: string; title?: string } = { content: c }
      if (title !== '') patch.title = title
      void useNotesStore.getState().updateNote(prevId, patch)
    }
    prevNoteIdRef.current = activeNote?.id ?? null

    const content = activeNote?.content ?? ''
    setLocalContent(content)
    localContentRef.current = content
    setContextMenu(null)
    if (debounceRef.current) { clearTimeout(debounceRef.current); debounceRef.current = null }
  }, [activeNote?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  // Reflete mudança de conteúdo vinda de FORA (sync da task do Ops / realtime) na
  // MESMA nota aberta — só quando não há edição pendente (debounce).
  useEffect(() => {
    if (debounceRef.current) return
    const ext = activeNote?.content ?? ''
    if (ext !== localContentRef.current) {
      setLocalContent(ext)
      localContentRef.current = ext
    }
  }, [activeNote?.content]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    return () => {
      if (debounceRef.current) { clearTimeout(debounceRef.current); debounceRef.current = null }
      if (isReadOnlyRef.current) return
      const id = activeNoteIdRef.current
      const content = localContentRef.current
      if (id && content !== undefined) void useNotesStore.getState().updateNote(id, { content })
    }
  }, [])

  useEffect(() => {
    const handleClick = () => setContextMenu(null)
    window.addEventListener('click', handleClick)
    return () => window.removeEventListener('click', handleClick)
  }, [])

  useEffect(() => {
    const handleForceSave = () => {
      if (debounceRef.current) { clearTimeout(debounceRef.current); debounceRef.current = null }
      if (isReadOnlyRef.current) return
      const id = activeNoteIdRef.current
      if (!id) return
      void updateNote(id, { content: localContentRef.current })
    }
    const handleSelectAll = () => editorRef.current?.selectAll()
    window.addEventListener('force-save', handleForceSave)
    window.addEventListener('select-all', handleSelectAll)
    return () => {
      window.removeEventListener('force-save', handleForceSave)
      window.removeEventListener('select-all', handleSelectAll)
    }
  }, [updateNote])

  // Edição no editor → salva com debounce + auto-título (1ª linha).
  const handleContentChange = useCallback(
    (newContent: string) => {
      if (isReadOnly) return
      setLocalContent(newContent)
      localContentRef.current = newContent
      setSaveState('saving')
      if (debounceRef.current) clearTimeout(debounceRef.current)
      debounceRef.current = setTimeout(async () => {
        debounceRef.current = null
        const id = activeNoteIdRef.current
        if (!id) return
        const nextTitle = deriveTitle(newContent)
        const cur = useNotesStore.getState().notes.find((n) => n.id === id)
        const patch: { content: string; title?: string } = { content: newContent }
        if (nextTitle !== '' && cur?.title !== nextTitle) patch.title = nextTitle
        await updateNote(id, patch)
        setSaveState('saved')
        if (savedTimerRef.current) clearTimeout(savedTimerRef.current)
        savedTimerRef.current = setTimeout(() => setSaveState('idle'), 1500)
      }, 500)
    },
    [updateNote, setSaveState, isReadOnly],
  )

  const onCursor = useCallback((line: number, col: number) => setCursor(line, col), [setCursor])

  const onPasteImage = useCallback(
    (files: File[]) => {
      if (isReadOnly) return false
      const id = activeNoteIdRef.current
      if (!id) return false
      void useMediaStore.getState().uploadFiles(id, files)
      return true
    },
    [isReadOnly],
  )

  const applyFormat = useCallback((kind: FormatKind) => {
    editorRef.current?.applyFormat(kind)
    setContextMenu(null)
  }, [])

  const openAnnotation = useCallback(() => {
    if (!contextMenu) return
    setAnnotationDraft({ text: contextMenu.text, start: contextMenu.from, end: contextMenu.to })
    setShowAnnotationModal(true)
    setContextMenu(null)
  }, [contextMenu])

  if (!activeNote) {
    return (
      <div
        className="editor-content flex flex-1 flex-col items-center justify-center"
        style={{ backgroundColor: '#2d2d2d', gap: '12px', boxShadow: 'inset 0 1px 0 rgba(0,0,0,0.25)' }}
      >
        <NotebookPen size={64} style={{ color: '#3d3d3d' }} />
        <span style={{ fontSize: '18px', fontWeight: 500, color: '#3d3d3d' }}>Ops Notas</span>
        <span style={{ fontSize: '13px', color: '#2a2a2a' }}>Ctrl+N para criar uma nota</span>
      </div>
    )
  }

  return (
    <div className="editor-content flex flex-1 flex-col overflow-hidden" style={{ boxShadow: 'inset 0 1px 0 rgba(0,0,0,0.25)' }}>
      <NoteDetailBar />

      {!isReadOnly && (
        <div className="flex items-center gap-0.5 px-3" style={{ minHeight: 34, paddingTop: 4, paddingBottom: 4, backgroundColor: '#262626', borderBottom: '1px solid #2a2a2a', flexWrap: 'wrap' }}>
          {TOOLBAR.map((it) => (
            <span key={it.kind} style={{ display: 'inline-flex', alignItems: 'center' }}>
              {it.sep && <span style={{ width: 1, height: 16, backgroundColor: '#3a3a3a', margin: '0 5px' }} />}
              <button
                onMouseDown={(e) => { e.preventDefault(); applyFormat(it.kind) }}
                className="flex items-center justify-center rounded transition-colors hover:bg-zinc-700"
                style={{ width: 26, height: 26, color: '#b4b4bb' }}
                title={it.title}
              >
                <it.icon size={14} />
              </button>
            </span>
          ))}
        </div>
      )}

      <div className="flex flex-1 overflow-hidden">
        {subnoteSide === 'left' && <SubnoteTree />}
        <MarkdownEditor
          ref={editorRef}
          value={localContent}
          onChange={handleContentChange}
          onCursor={onCursor}
          onPasteImage={onPasteImage}
          onContextMenu={(info) => { if (isReadOnly && !info.hasSelection) return; setContextMenu(info) }}
          readOnly={isReadOnly}
          showLineNumbers={showLineNumbers}
          wordWrap={wordWrap}
          fontSize={fontSize}
          placeholder="Comece a escrever..."
        />
        {subnoteSide === 'right' && <SubnoteTree />}
      </div>

      <NoteMediaStrip noteId={activeNote.id} canEdit={!isReadOnly} />

      {contextMenu && (
        <div
          className="fixed z-30 rounded-xl border"
          style={{ left: contextMenu.x, top: contextMenu.y, width: 232, backgroundColor: '#1e1e1e', borderColor: '#333333', boxShadow: '0 10px 30px rgba(0,0,0,0.4)', padding: 5 }}
          onClick={(e) => e.stopPropagation()}
        >
          {!isReadOnly && (
            <>
              <div style={{ padding: '3px 8px 4px', fontSize: 11, color: '#71717a' }}>Formatar</div>
              <div className="flex" style={{ gap: 2, padding: '0 4px 4px' }}>
                {([['bold', Bold], ['italic', Italic], ['underline', Underline], ['strike', Strikethrough], ['highlight', Highlighter], ['code', Code]] as [FormatKind, typeof Bold][]).map(([k, Ic]) => (
                  <button key={k} onMouseDown={(e) => { e.preventDefault(); applyFormat(k) }}
                    className="flex flex-1 items-center justify-center rounded-md transition-colors hover:bg-zinc-800"
                    style={{ height: 30, color: '#d4d4d8' }}>
                    <Ic size={14} />
                  </button>
                ))}
              </div>
              <div style={{ height: '0.5px', backgroundColor: '#333', margin: '3px 0' }} />
              <div style={{ padding: '3px 8px 4px', fontSize: 11, color: '#71717a' }}>Transformar em</div>
              <MenuItem icon={<Heading1 size={14} />} label="Título" onClick={() => applyFormat('h1')} />
              <MenuItem icon={<Heading2 size={14} />} label="Subtítulo" onClick={() => applyFormat('h2')} />
              <MenuItem icon={<ListChecks size={14} style={{ color: '#34d399' }} />} label="Checklist" onClick={() => applyFormat('checklist')} />
              <MenuItem icon={<List size={14} />} label="Lista" onClick={() => applyFormat('ul')} />
              <MenuItem icon={<ListOrdered size={14} />} label="Lista numerada" onClick={() => applyFormat('ol')} />
              <MenuItem icon={<Quote size={14} />} label="Citação" onClick={() => applyFormat('quote')} />
              <div style={{ height: '0.5px', backgroundColor: '#333', margin: '3px 0' }} />
              <div style={{ padding: '3px 8px 4px', fontSize: 11, color: '#71717a' }}>Inserir</div>
              <MenuItem icon={<Minus size={14} />} label="Divisor" onClick={() => applyFormat('divider')} />
              <MenuItem icon={<Link2 size={14} />} label="Link" onClick={() => applyFormat('link')} />
              <MenuItem icon={<Calendar size={14} />} label="Data de hoje" onClick={() => applyFormat('today')} />
            </>
          )}
          {contextMenu.hasSelection && (
            <>
              {!isReadOnly && <div style={{ height: '0.5px', backgroundColor: '#333', margin: '3px 0' }} />}
              <MenuItem icon={<Building2 size={14} style={{ color: '#10b981' }} />} label="Adicionar trecho à empresa" onClick={openAnnotation} accent />
            </>
          )}
        </div>
      )}

      <AddAnnotationToCompanyModal
        key={annotationDraft ? `${annotationDraft.start}-${annotationDraft.end}` : 'closed'}
        visible={showAnnotationModal && annotationDraft !== null}
        excerpt={annotationDraft?.text ?? ''}
        noteId={activeNote.id}
        noteTitle={activeNote.title}
        selectionStart={annotationDraft?.start ?? 0}
        selectionEnd={annotationDraft?.end ?? 0}
        initialClientId={activeNote.client_id}
        onClose={() => { setShowAnnotationModal(false); setAnnotationDraft(null) }}
      />
    </div>
  )
}

function MenuItem({ icon, label, onClick, accent }: { icon: React.ReactNode; label: string; onClick: () => void; accent?: boolean }) {
  return (
    <button
      onMouseDown={(e) => { e.preventDefault(); onClick() }}
      className="flex w-full items-center gap-2.5 rounded-md transition-colors hover:bg-zinc-800"
      style={{ padding: '6px 9px', fontSize: 13, color: accent ? '#d1fae5' : '#d4d4d8' }}
    >
      <span style={{ color: '#9a9aa3', display: 'inline-flex' }}>{icon}</span>
      {label}
    </button>
  )
}
