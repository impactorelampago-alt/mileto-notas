import { useState, useRef, useCallback } from 'react'

export default function Editor() {
  const [content, setContent] = useState('')
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const lineNumbersRef = useRef<HTMLDivElement>(null)

  const lineCount = content === '' ? 1 : content.split('\n').length

  const handleScroll = useCallback(() => {
    if (lineNumbersRef.current && textareaRef.current) {
      lineNumbersRef.current.scrollTop = textareaRef.current.scrollTop
    }
  }, [])

  return (
    <div className="editor-content flex flex-1 overflow-hidden">
      {/* Números de linha */}
      <div
        ref={lineNumbersRef}
        className="no-scrollbar w-[54px] shrink-0 select-none overflow-y-scroll bg-[#111113] pt-3 text-right text-[13px] text-zinc-400"
        style={{
          lineHeight: '22.4px',
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

      {/* Textarea */}
      <textarea
        ref={textareaRef}
        value={content}
        onChange={(e) => setContent(e.target.value)}
        onScroll={handleScroll}
        placeholder="Comece a escrever..."
        spellCheck={false}
        className="editor-textarea flex-1 resize-none bg-zinc-950 pl-4 pr-6 pt-3 pb-4 text-[14px] text-zinc-100 outline-none placeholder:text-zinc-700"
        style={{
          fontFamily: "'JetBrains Mono', monospace",
          lineHeight: '22.4px',
          caretColor: '#f4f4f5',
        }}
      />
    </div>
  )
}
