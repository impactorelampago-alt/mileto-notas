import { useState, useRef, useCallback, useEffect } from 'react'
import { NotebookPen } from 'lucide-react'
import { useNotesStore } from '../../stores/notes-store'
import { useUIStore } from '../../stores/ui-store'
import AddAnnotationToCompanyModal from '../ui/AddAnnotationToCompanyModal'

export default function Editor() {
  const activeNote = useNotesStore((s) => s.notes.find((n) => n.id === s.activeTabId) ?? null)
  const updateNote = useNotesStore((s) => s.updateNote)
  const { fontSize, showLineNumbers, wordWrap, setCursor } = useUIStore()

  const [localContent, setLocalContent] = useState(() => activeNote?.content ?? '')
  const [localTitle, setLocalTitle] = useState(() => activeNote?.title ?? '')
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; text: string; start: number; end: number } | null>(null)
  const [annotationDraft, setAnnotationDraft] = useState<{ text: string; start: number; end: number } | null>(null)
  const [showAnnotationModal, setShowAnnotationModal] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const lineNumbersRef = useRef<HTMLDivElement>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const titleDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const localContentRef = useRef<string>(activeNote?.content ?? '')
  const localTitleRef = useRef<string>(activeNote?.title ?? '')
  const activeNoteIdRef = useRef<string | null>(null)
  activeNoteIdRef.current = activeNote?.id ?? null

  const lineHeight = fontSize * 1.6

  useEffect(() => {
    const content = activeNote?.content ?? ''
    const title = activeNote?.title ?? ''
    setLocalContent(content)
    setLocalTitle(title)
    localContentRef.current = content
    localTitleRef.current = title
    setContextMenu(null)
    if (debounceRef.current) {
      clearTimeout(debounceRef.current)
      debounceRef.current = null
    }
    if (titleDebounceRef.current) {
      clearTimeout(titleDebounceRef.current)
      titleDebounceRef.current = null
    }
  }, [activeNote?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current)
        debounceRef.current = null
      }
      const id = activeNoteIdRef.current
      const content = localContentRef.current
      const title = localTitleRef.current
      if (id && content !== undefined) {
        void useNotesStore.getState().updateNote(id, { content, title })
      }
    }
  }, [])

  useEffect(() => {
    const handleClick = () => {
      setContextMenu(null)
    }
    window.addEventListener('click', handleClick)
    return () => window.removeEventListener('click', handleClick)
  }, [])

  useEffect(() => {
    const handleForceSave = () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current)
        debounceRef.current = null
      }
      const id = activeNoteIdRef.current
      if (!id) return
      void updateNote(id, { content: localContent, title: localTitleRef.current })
    }

    const handleSelectAll = () => {
      textareaRef.current?.select()
    }

    window.addEventListener('force-save', handleForceSave)
    window.addEventListener('select-all', handleSelectAll)
    return () => {
      window.removeEventListener('force-save', handleForceSave)
      window.removeEventListener('select-all', handleSelectAll)
    }
  }, [localContent, updateNote])

  const handleScroll = useCallback(() => {
    if (lineNumbersRef.current && textareaRef.current) {
      lineNumbersRef.current.scrollTop = textareaRef.current.scrollTop
    }
  }, [])

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      const newContent = e.target.value
      setLocalContent(newContent)
      localContentRef.current = newContent

      if (debounceRef.current) clearTimeout(debounceRef.current)
      debounceRef.current = setTimeout(() => {
        const id = activeNoteIdRef.current
        if (!id) return
        void updateNote(id, { content: newContent })
      }, 500)
    },
    [updateNote],
  )

  const handleTitleChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const newTitle = e.target.value
    setLocalTitle(newTitle)
    localTitleRef.current = newTitle

    if (titleDebounceRef.current) clearTimeout(titleDebounceRef.current)
    titleDebounceRef.current = setTimeout(() => {
      const id = activeNoteIdRef.current
      if (!id) return
      void updateNote(id, { title: newTitle.trim() || 'Sem título' })
    }, 350)
  }, [updateNote])

  const handleTitleBlur = () => {
    if (titleDebounceRef.current) {
      clearTimeout(titleDebounceRef.current)
      titleDebounceRef.current = null
    }
    const id = activeNoteIdRef.current
    if (!id) return
    const normalizedTitle = localTitle.trim() || 'Sem título'
    if (normalizedTitle !== localTitle) {
      setLocalTitle(normalizedTitle)
      localTitleRef.current = normalizedTitle
    }
    void updateNote(id, { title: normalizedTitle })
  }

  const updateCursor = useCallback(() => {
    const el = textareaRef.current
    if (!el) return
    const text = el.value.slice(0, el.selectionStart)
    const lines = text.split('\n')
    setCursor(lines.length, lines[lines.length - 1].length + 1)
  }, [setCursor])

  const lineCount = localContent === '' ? 1 : localContent.split('\n').length

  if (!activeNote) {
    return (
      <div
        className="editor-content flex flex-1 flex-col items-center justify-center"
        style={{ backgroundColor: '#2d2d2d', gap: '12px' }}
      >
        <NotebookPen size={64} style={{ color: '#3d3d3d' }} />
        <span style={{ fontSize: '18px', fontWeight: 500, color: '#3d3d3d' }}>Ops Notas</span>
        <span style={{ fontSize: '13px', color: '#2a2a2a' }}>Ctrl+N para criar uma nota</span>
      </div>
    )
  }

  return (
    <div className="editor-content flex flex-1 flex-col overflow-hidden">
      <input
        value={localTitle}
        onChange={handleTitleChange}
        onBlur={handleTitleBlur}
        placeholder="Título da nota"
        className="shrink-0 bg-transparent outline-none"
        style={{
          color: '#f4f4f5',
          fontSize: '15px',
          fontWeight: 500,
          padding: '10px 18px',
          backgroundColor: '#252526',
          borderBottom: '1px solid #2c2c2c',
        }}
      />

      <div className="flex flex-1 overflow-hidden">
        {showLineNumbers && (
          <div
            ref={lineNumbersRef}
            className="no-scrollbar w-[45px] shrink-0 select-none overflow-y-scroll text-right"
            style={{
              backgroundColor: '#252526',
              color: '#6d6d6d',
              lineHeight: `${lineHeight}px`,
              fontSize: `${fontSize - 1}px`,
              fontFamily: "'JetBrains Mono', Consolas, monospace",
              borderRight: '1px solid #3d3d3d',
              paddingTop: '16px',
            }}
            aria-hidden="true"
          >
            <div style={{ paddingRight: '20px', paddingLeft: '12px' }}>
              {Array.from({ length: lineCount }, (_, i) => (
                <div key={i + 1}>{i + 1}</div>
              ))}
            </div>
          </div>
        )}

        <textarea
          ref={textareaRef}
          value={localContent}
          onChange={handleChange}
          onScroll={handleScroll}
          onKeyUp={updateCursor}
          onClick={updateCursor}
          onSelect={updateCursor}
          onContextMenu={(e) => {
            const el = textareaRef.current
            if (!el) return
            const selectionStart = el.selectionStart
            const selectionEnd = el.selectionEnd
            if (selectionStart === selectionEnd) return
            const selectedText = el.value.slice(selectionStart, selectionEnd).trim()
            if (!selectedText) return
            e.preventDefault()
            setContextMenu({
              x: e.clientX,
              y: e.clientY,
              text: selectedText,
              start: selectionStart,
              end: selectionEnd,
            })
          }}
          placeholder=""
          spellCheck={false}
          wrap={wordWrap ? 'soft' : 'off'}
          className="editor-textarea flex-1 resize-none outline-none"
          style={{
            backgroundColor: '#2d2d2d',
            color: '#cccccc',
            fontFamily: "'JetBrains Mono', Consolas, monospace",
            fontSize: `${fontSize}px`,
            lineHeight: `${lineHeight}px`,
            caretColor: '#cccccc',
            overflowX: wordWrap ? 'hidden' : 'auto',
            paddingLeft: '24px',
            paddingRight: '24px',
            paddingTop: '16px',
            paddingBottom: '16px',
          }}
        />
      </div>

      {contextMenu && (
        <div
          className="fixed z-30 min-w-[220px] rounded-xl border"
          style={{
            left: contextMenu.x,
            top: contextMenu.y,
            backgroundColor: '#1e1e1e',
            borderColor: '#333333',
            boxShadow: '0 10px 30px rgba(0,0,0,0.35)',
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            onClick={() => {
              setAnnotationDraft({
                text: contextMenu.text,
                start: contextMenu.start,
                end: contextMenu.end,
              })
              setShowAnnotationModal(true)
              setContextMenu(null)
            }}
            className="flex w-full items-center gap-3 px-3 py-2.5 text-left"
            style={{ color: '#d4d4d8', fontSize: '13px' }}
          >
            <span style={{ width: 10, height: 10, borderRadius: '999px', backgroundColor: '#10b981' }} />
            Adicionar trecho à empresa
          </button>
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
        onClose={() => {
          setShowAnnotationModal(false)
          setAnnotationDraft(null)
        }}
      />
    </div>
  )
}
