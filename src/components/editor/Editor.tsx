import { useState, useRef, useCallback, useEffect } from 'react'
import { useNotesStore } from '../../stores/notes-store'
import { useUIStore } from '../../stores/ui-store'

function extractTitle(content: string): string {
  const firstLine = content.split('\n')[0].trim()
  if (!firstLine) return 'Nova nota'
  return firstLine.slice(0, 50)
}

export default function Editor() {
  const activeNote = useNotesStore((s) => s.notes.find((n) => n.id === s.activeTabId) ?? null)
  const updateNote = useNotesStore((s) => s.updateNote)
  const { fontSize, showLineNumbers, wordWrap, setCursor } = useUIStore()

  const [localContent, setLocalContent] = useState(activeNote?.content ?? '')
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const lineNumbersRef = useRef<HTMLDivElement>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const activeNoteIdRef = useRef<string | null>(null)
  activeNoteIdRef.current = activeNote?.id ?? null

  const lineHeight = fontSize * 1.6

  // Sync local content when switching notes
  useEffect(() => {
    setLocalContent(activeNote?.content ?? '')
    if (debounceRef.current) {
      clearTimeout(debounceRef.current)
      debounceRef.current = null
    }
  }, [activeNote?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  // Cleanup debounce on unmount
  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
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
      const title = extractTitle(localContent)
      void updateNote(id, { content: localContent, title })
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

      if (debounceRef.current) clearTimeout(debounceRef.current)
      debounceRef.current = setTimeout(() => {
        const id = activeNoteIdRef.current
        if (!id) return
        const title = extractTitle(newContent)
        void updateNote(id, { content: newContent, title })
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
      <div className="editor-content flex flex-1 items-center justify-center bg-zinc-950">
        <p className="text-[13px] text-zinc-600">Selecione ou crie uma nota</p>
      </div>
    )
  }

  return (
    <div className="editor-content flex flex-1 overflow-hidden">
      {showLineNumbers && (
        <div
          ref={lineNumbersRef}
          className="no-scrollbar w-[54px] shrink-0 select-none overflow-y-scroll bg-[#111113] pt-3 text-right text-zinc-400"
          style={{
            lineHeight: `${lineHeight}px`,
            fontSize: `${fontSize - 1}px`,
            fontFamily: "'JetBrains Mono', monospace",
            boxShadow: '1px 0 0 0 rgba(16, 185, 129, 0.2)',
          }}
          aria-hidden="true"
        >
          <div className="pr-3 pl-2">
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
        placeholder="Comece a escrever..."
        spellCheck={false}
        wrap={wordWrap ? 'soft' : 'off'}
        className="editor-textarea flex-1 resize-none bg-zinc-950 pl-4 pr-6 pt-3 pb-4 text-zinc-100 outline-none placeholder:text-zinc-700"
        style={{
          fontFamily: "'JetBrains Mono', monospace",
          fontSize: `${fontSize}px`,
          lineHeight: `${lineHeight}px`,
          caretColor: '#f4f4f5',
          overflowX: wordWrap ? 'hidden' : 'auto',
        }}
      />
    </div>
  )
}
