import { useState, useRef, useCallback, useEffect } from 'react'
import { NotebookPen } from 'lucide-react'
import { useNotesStore } from '../../stores/notes-store'
import { useUIStore } from '../../stores/ui-store'


export default function Editor() {
  const activeNote = useNotesStore((s) => s.notes.find((n) => n.id === s.activeTabId) ?? null)
  const updateNote = useNotesStore((s) => s.updateNote)
  const { fontSize, showLineNumbers, wordWrap, setCursor } = useUIStore()

  const [localContent, setLocalContent] = useState(() => activeNote?.content ?? '')
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const lineNumbersRef = useRef<HTMLDivElement>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const localContentRef = useRef<string>(activeNote?.content ?? '')
  const activeNoteIdRef = useRef<string | null>(null)
  activeNoteIdRef.current = activeNote?.id ?? null

  const lineHeight = fontSize * 1.6

  // Sync local content when switching notes
  useEffect(() => {
    const content = activeNote?.content ?? ''
    setLocalContent(content)
    localContentRef.current = content
    if (debounceRef.current) {
      clearTimeout(debounceRef.current)
      debounceRef.current = null
    }
  }, [activeNote?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  // Flush pendente + cleanup no unmount
  useEffect(() => {
    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current)
        debounceRef.current = null
      }
      const id = activeNoteIdRef.current
      const content = localContentRef.current
      if (id && content !== undefined) {
        void useNotesStore.getState().updateNote(id, { content })
      }
    }
  }, [])

  // Custom events from MenuBar
  useEffect(() => {
    const handleForceSave = () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current)
        debounceRef.current = null
      }
      const id = activeNoteIdRef.current
      if (!id) return
      void updateNote(id, { content: localContent })
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
    <div className="editor-content flex flex-1 overflow-hidden">
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
  )
}
