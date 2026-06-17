import { useState, useRef, useCallback, useEffect } from 'react'
import { NotebookPen } from 'lucide-react'
import { useNotesStore } from '../../stores/notes-store'
import { useUIStore } from '../../stores/ui-store'
import { useMediaStore } from '../../stores/media-store'
import { useAuthStore } from '../../stores/auth-store'
import AddAnnotationToCompanyModal from '../ui/AddAnnotationToCompanyModal'
import NoteMediaStrip from './NoteMediaStrip'
import NoteDetailBar from './NoteDetailBar'

export default function Editor() {
  const activeNote = useNotesStore((s) => s.notes.find((n) => n.id === s.activeTabId) ?? null)
  const updateNote = useNotesStore((s) => s.updateNote)
  const viewAll = useAuthStore((s) => s.viewAll)
  // Re-renderiza quando os conjuntos de permissão chegam (canEditNote os lê).
  useAuthStore((s) => s.editableIds)
  const canEditNote = useAuthStore((s) => s.canEditNote)
  const { fontSize, showLineNumbers, wordWrap, setCursor, setSaveState } = useUIStore()

  const [localContent, setLocalContent] = useState(() => activeNote?.content ?? '')
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; text: string; start: number; end: number } | null>(null)
  const [annotationDraft, setAnnotationDraft] = useState<{ text: string; start: number; end: number } | null>(null)
  const [showAnnotationModal, setShowAnnotationModal] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const lineNumbersRef = useRef<HTMLDivElement>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const savedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const localContentRef = useRef<string>(activeNote?.content ?? '')
  const activeNoteIdRef = useRef<string | null>(null)
  activeNoteIdRef.current = activeNote?.id ?? null
  const prevNoteIdRef = useRef<string | null>(activeNote?.id ?? null)

  const lineHeight = fontSize * 1.6

  // Posso EDITAR esta nota? Regra única em auth-store.canEditNote (própria/DONO/
  // compartilhada-EDIT/cargo com EDITAR). Modo "Todos" é sempre só-leitura. Cobre
  // impersonar alguém que você só pode VER.
  const isReadOnly = viewAll || (!!activeNote && !canEditNote(activeNote))
  // Ref p/ os handlers de deps vazias (unmount/force-save) lerem o estado atual.
  const isReadOnlyRef = useRef(isReadOnly)
  isReadOnlyRef.current = isReadOnly

  useEffect(() => {
    // ANTES de trocar de nota, salva o que foi digitado na nota ANTERIOR — a
    // edição pode não ter passado pelo debounce de 500ms (que é cancelado aqui),
    // então sem isso o texto recém-digitado some ao voltar pra aba. (Bug grave.)
    const prevId = prevNoteIdRef.current
    if (prevId && prevId !== activeNote?.id) {
      // Salva conteúdo (e título = 1ª linha) da nota anterior — o debounce de
      // 500ms é cancelado na troca, então sem isso o texto recém-digitado some.
      const c = localContentRef.current
      const firstLine = c.split('\n').find((l) => l.trim() !== '')?.trim() ?? ''
      // Título acompanha a 1ª linha; conteúdo VAZIO preserva o título atual (NÃO
      // vira "Sem título") — senão abrir uma nota de task do Ops sem descrição e
      // trocar de aba apagaria o título no banco compartilhado (tasks.title).
      const patch: { content: string; title?: string } = { content: c }
      if (firstLine !== '') patch.title = firstLine.slice(0, 60)
      void useNotesStore.getState().updateNote(prevId, patch)
    }
    prevNoteIdRef.current = activeNote?.id ?? null

    const content = activeNote?.content ?? ''
    setLocalContent(content)
    localContentRef.current = content
    setContextMenu(null)
    if (debounceRef.current) {
      clearTimeout(debounceRef.current)
      debounceRef.current = null
    }
  }, [activeNote?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  // Reflete no editor mudanças de conteúdo vindas de FORA (sync da description da
  // task do Ops, realtime) enquanto ESTA MESMA nota está aberta. Sem isto, o
  // contador atualiza mas o textarea fica vazio até trocar de aba ("aparece
  // minutos depois"). Não mexe se o usuário está digitando (debounce pendente) nem
  // quando o conteúdo externo já é igual ao do editor.
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
      if (debounceRef.current) {
        clearTimeout(debounceRef.current)
        debounceRef.current = null
      }
      if (isReadOnlyRef.current) return // só-leitura: nada a salvar
      const id = activeNoteIdRef.current
      const content = localContentRef.current
      if (id && content !== undefined) {
        void useNotesStore.getState().updateNote(id, { content })
      }
    }
  }, [])

  useEffect(() => {
    const handleClick = () => setContextMenu(null)
    window.addEventListener('click', handleClick)
    return () => window.removeEventListener('click', handleClick)
  }, [])

  useEffect(() => {
    const handleForceSave = () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current)
        debounceRef.current = null
      }
      if (isReadOnlyRef.current) return // só-leitura: nada a salvar
      const id = activeNoteIdRef.current
      if (!id) return
      void updateNote(id, { content: localContentRef.current })
    }
    const handleSelectAll = () => textareaRef.current?.select()
    window.addEventListener('force-save', handleForceSave)
    window.addEventListener('select-all', handleSelectAll)
    return () => {
      window.removeEventListener('force-save', handleForceSave)
      window.removeEventListener('select-all', handleSelectAll)
    }
  }, [updateNote])

  const handleScroll = useCallback(() => {
    if (lineNumbersRef.current && textareaRef.current) {
      lineNumbersRef.current.scrollTop = textareaRef.current.scrollTop
    }
  }, [])

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      if (isReadOnly) return
      const newContent = e.target.value
      setLocalContent(newContent)
      localContentRef.current = newContent
      setSaveState('saving')

      if (debounceRef.current) clearTimeout(debounceRef.current)
      debounceRef.current = setTimeout(async () => {
        // Edição não está mais "pendente" — libera o efeito de sync externo abaixo
        // a refletir mudanças vindas da task/realtime nesta nota.
        debounceRef.current = null
        const id = activeNoteIdRef.current
        if (!id) return
        // Título acompanha a 1ª linha não-vazia do conteúdo (modelo "título =
        // primeira linha"). Conteúdo VAZIO preserva o título atual (não vira
        // "Sem título"). Conteúdo e título vão no MESMO update: um só patch →
        // um só evento de realtime, e sem update só-de-título (que deixaria a
        // nota presa em _pendingDraftIds e mataria o sync/realtime dela).
        const firstLine = newContent.split('\n').find((l) => l.trim() !== '')?.trim() ?? ''
        const cur = useNotesStore.getState().notes.find((n) => n.id === id)
        const patch: { content: string; title?: string } = { content: newContent }
        if (firstLine !== '') {
          const nextTitle = firstLine.slice(0, 60)
          if (cur?.title !== nextTitle) patch.title = nextTitle
        }
        await updateNote(id, patch)
        setSaveState('saved')
        if (savedTimerRef.current) clearTimeout(savedTimerRef.current)
        savedTimerRef.current = setTimeout(() => setSaveState('idle'), 1500)
      }, 500)
    },
    [updateNote, setSaveState, isReadOnly],
  )

  const updateCursor = useCallback(() => {
    const el = textareaRef.current
    if (!el) return
    const text = el.value.slice(0, el.selectionStart)
    const lines = text.split('\n')
    setCursor(lines.length, lines[lines.length - 1].length + 1)
  }, [setCursor])

  // Colar imagem (Ctrl+V): se o clipboard tem imagem, anexa como mídia em vez de
  // colar como texto. Texto normal segue o comportamento padrão.
  const handlePaste = useCallback(
    (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
      if (isReadOnly) return
      const items = e.clipboardData?.items
      if (!items) return
      const files: File[] = []
      for (let i = 0; i < items.length; i++) {
        const it = items[i]
        if (it.kind === 'file' && it.type.startsWith('image/')) {
          const f = it.getAsFile()
          if (f) files.push(f)
        }
      }
      const id = activeNoteIdRef.current
      if (files.length > 0 && id) {
        e.preventDefault()
        void useMediaStore.getState().uploadFiles(id, files)
      }
    },
    [isReadOnly],
  )

  const lineCount = localContent === '' ? 1 : localContent.split('\n').length

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
      <div className="flex flex-1 overflow-hidden">
        {showLineNumbers && (
          <div
            ref={lineNumbersRef}
            className="no-scrollbar w-[52px] shrink-0 select-none overflow-y-scroll text-right"
            style={{
              backgroundColor: '#252526',
              color: '#6d6d6d',
              lineHeight: `${lineHeight}px`,
              fontSize: `${fontSize - 1}px`,
              fontFamily: "'JetBrains Mono', Consolas, monospace",
              borderRight: '1px solid #353535',
              paddingTop: '22px',
            }}
            aria-hidden="true"
          >
            <div style={{ paddingRight: '16px', paddingLeft: '12px' }}>
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
          onPaste={handlePaste}
          onContextMenu={(e) => {
            if (isReadOnly) return
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
          placeholder="Comece a escrever..."
          spellCheck={false}
          readOnly={isReadOnly}
          wrap={wordWrap ? 'soft' : 'off'}
          className="editor-textarea flex-1 resize-none outline-none"
          style={{
            backgroundColor: '#2d2d2d',
            color: '#cccccc',
            fontFamily: "'JetBrains Mono', Consolas, monospace",
            fontSize: `${fontSize}px`,
            lineHeight: `${lineHeight}px`,
            caretColor: isReadOnly ? 'transparent' : '#cccccc',
            opacity: isReadOnly ? 0.85 : 1,
            cursor: isReadOnly ? 'default' : 'text',
            overflowX: wordWrap ? 'hidden' : 'auto',
            paddingLeft: '32px',
            paddingRight: '32px',
            paddingTop: '22px',
            paddingBottom: '22px',
          }}
        />
      </div>

      {/* Fileira de mídias no rodapé da nota (upload / Ctrl+V / arrastar). */}
      <NoteMediaStrip noteId={activeNote.id} canEdit={!isReadOnly} />

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
