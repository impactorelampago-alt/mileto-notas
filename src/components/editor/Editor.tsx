import { useState, useRef, useCallback, useEffect, useLayoutEffect, useMemo } from 'react'
import {
  NotebookPen, Bold, Italic, Underline, Strikethrough, Highlighter, Code,
  Heading1, Heading2, List, ListOrdered, ListChecks, Quote, Link2, Minus, Building2, Calendar,
  Share2, AtSign, X as XIcon,
  AlignLeft, AlignCenter, AlignRight, AlignJustify,
} from 'lucide-react'
import { useNotesStore } from '../../stores/notes-store'
import { useUIStore } from '../../stores/ui-store'
import { useMediaStore } from '../../stores/media-store'
import { useAuthStore } from '../../stores/auth-store'
import { useEditsStore } from '../../stores/edits-store'
import AddAnnotationToCompanyModal from '../ui/AddAnnotationToCompanyModal'
import NoteMediaStrip from './NoteMediaStrip'
import NoteDetailBar from './NoteDetailBar'
import SubnoteTree from './SubnoteTree'
import MarkdownEditor, { type MarkdownEditorHandle } from './MarkdownEditor'
import type { FormatKind } from './markdown-cm'
import { usePresenceStore } from '../../stores/presence-store'
import { useCollabStore } from '../../stores/collab-store'
import { saveDraft } from '../../lib/local-drafts'

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
    .replace(/\{\{(?:img:[0-9a-fA-F]{4,32}|[crj])\}\}/g, '') // chip de imagem + alinhamento
    .trim()
    .slice(0, 60)
}

type CtxInfo = { x: number; y: number; hasSelection: boolean; text: string; from: number; to: number }

export default function Editor() {
  const activeNote = useNotesStore((s) => s.notes.find((n) => n.id === s.activeTabId) ?? null)
  const updateNote = useNotesStore((s) => s.updateNote)
  const viewAll = useAuthStore((s) => s.viewAll)
  useAuthStore((s) => s.editableIds) // re-renderiza quando as permissões carregam (canEditNote depende delas)
  const canEditNote = useAuthStore((s) => s.canEditNote)
  const isDono = useAuthStore((s) => s.isDono())
  const myName = useAuthStore((s) => s.profile?.name ?? null)
  const { fontSize, showLineNumbers, wordWrap, setCursor, setSaveState } = useUIStore()
  const subnoteSide = useUIStore((s) => s.subnoteSide)
  const flashMentionNoteId = useUIStore((s) => s.flashMentionNoteId)
  const setFlashMentionNoteId = useUIStore((s) => s.setFlashMentionNoteId)
  const setSharePickerTarget = useUIStore((s) => s.setSharePickerTarget)
  const meId = useAuthStore((s) => s.user?.id ?? null)
  const peers = usePresenceStore((s) => s.peers)
  const joinPresence = usePresenceStore((s) => s.join)
  const leavePresence = usePresenceStore((s) => s.leave)
  const setPresenceCursor = usePresenceStore((s) => s.setLocalCursor)
  const collabSession = useCollabStore((s) => s.session)
  const collabPeers = useCollabStore((s) => s.collabPeers)

  const [localContent, setLocalContent] = useState(() => activeNote?.content ?? '')
  const [mentionNoAccess, setMentionNoAccess] = useState<{ noteId: string; names: string[] } | null>(null)
  const [contextMenu, setContextMenu] = useState<CtxInfo | null>(null)
  const [annotationDraft, setAnnotationDraft] = useState<{ text: string; start: number; end: number } | null>(null)
  const [showAnnotationModal, setShowAnnotationModal] = useState(false)
  const editorRef = useRef<MarkdownEditorHandle>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const savedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const localContentRef = useRef<string>(activeNote?.content ?? '')
  // Baseline SINCRONIZADA: o conteúdo que o editor considera "a versão persistida"
  // (vinda do load/sync externo/nosso próprio save concluído). Os force-saves (troca de
  // nota / unmount / evento / fechar) só re-enviam se localContentRef != este baseline —
  // "sujo". Sem isto, só ABRIR uma nota (com base possivelmente velha) e sair já
  // re-gravava a base por cima da edição de OUTRA pessoa (sobrescrita colaborativa).
  const syncedContentRef = useRef<string>(activeNote?.content ?? '')
  const activeNoteIdRef = useRef<string | null>(null)
  activeNoteIdRef.current = activeNote?.id ?? null
  const prevNoteIdRef = useRef<string | null>(activeNote?.id ?? null)

  // Posso EDITAR? (própria/DONO/compartilhada-EDIT/cargo). "Todos" é só-leitura exceto DONO.
  const isReadOnly = !isDono && (viewAll || (!!activeNote && !canEditNote(activeNote)))
  // CO-EDIÇÃO ativa nesta nota? (sessão CRDT pronta pra a nota ativa — editor OU viewer
  // só-leitura vendo ao vivo). Se a sessão não abrir (rede/RLS/sem estado), collabOn=false
  // → modo simples (mostra notes.content; a edição nunca quebra).
  const collabOn = !!activeNote && collabSession?.noteId === activeNote.id
  const collabOnRef = useRef(collabOn)
  collabOnRef.current = collabOn
  const isReadOnlyRef = useRef(isReadOnly)
  isReadOnlyRef.current = isReadOnly

  // ANTES de trocar de nota, salva o texto (e título=1ª linha) da anterior — o
  // debounce de 500ms é cancelado na troca, senão o recém-digitado some.
  useEffect(() => {
    const prevId = prevNoteIdRef.current
    // Só persiste a nota anterior se ela foi REALMENTE editada (sujo). Re-enviar uma
    // base intocada — que pode estar velha — sobrescreveria a edição de outra pessoa.
    if (prevId && prevId !== activeNote?.id && localContentRef.current !== syncedContentRef.current) {
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
    syncedContentRef.current = content // baseline sincronizada da nova nota
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
    // Conteúdo externo aceito = nova baseline sincronizada (não estou com edição pendente).
    syncedContentRef.current = ext
  }, [activeNote?.content]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    return () => {
      if (debounceRef.current) { clearTimeout(debounceRef.current); debounceRef.current = null }
      if (isReadOnlyRef.current) return
      if (localContentRef.current === syncedContentRef.current) return // nada editado → não re-envia base
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
      if (localContentRef.current === syncedContentRef.current) return // nada editado → não re-envia base
      const id = activeNoteIdRef.current
      if (!id) return
      const title = deriveTitle(localContentRef.current)
      const patch: { content: string; title?: string } = { content: localContentRef.current }
      if (title !== '') patch.title = title
      void updateNote(id, patch)
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
      // CO-EDIÇÃO: o Yjs é a fonte e o collab-store salva o snapshot (ytext → notes.content).
      // Aqui NÃO disparamos updateNote (evita save duplo/conflito com o CRDT).
      if (collabOnRef.current) return
      const id = activeNoteIdRef.current
      if (id) {
        useCollabStore.getState().stageSimpleEdit(id, syncedContentRef.current, newContent)
      }
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
        syncedContentRef.current = newContent // edição persistida (ou virou rascunho) → nova baseline
        void useNotesStore.getState().notifyMentions(id) // avisa @menções novas
        void useEditsStore.getState().recordNoteEdit(id) // registra "quem editou, quando"
        setSaveState('saved')
        if (savedTimerRef.current) clearTimeout(savedTimerRef.current)
        savedTimerRef.current = setTimeout(() => setSaveState('idle'), 1500)
      }, 500)
    },
    [updateNote, setSaveState, isReadOnly],
  )

  const onCursor = useCallback((line: number, col: number) => setCursor(line, col), [setCursor])
  const onSelect = useCallback((anchor: number, head: number) => setPresenceCursor(anchor, head), [setPresenceCursor])

  // Presença colaborativa: entra no canal da nota ativa (nome/cor) e sai ao trocar/fechar.
  const peerList = useMemo(() => Object.values(peers), [peers])
  const remoteCursors = useMemo(
    () => peerList.map((p) => ({ userId: p.userId, name: p.name, color: p.color, anchor: p.anchor, head: p.head })),
    [peerList],
  )
  // Barra "quem está aqui": no CO-EDIÇÃO vem do awareness do Yjs (collabPeers); no
  // fallback, da presença Fase 1 (peers).
  const barPeers = useMemo(
    () => collabOn
      ? collabPeers.map((p) => ({ key: 'c' + p.clientId, name: p.name, color: p.color }))
      : peerList.map((p) => ({ key: p.userId, name: p.name, color: p.color })),
    [collabOn, collabPeers, peerList],
  )
  useEffect(() => {
    const id = activeNote?.id
    // No modo CO-EDIÇÃO os cursores vêm do awareness do Yjs (yCollab) → não usa a
    // presença Fase 1 (evita cursor duplicado). Presença Fase 1 fica só no fallback.
    if (!id || !meId || !myName || collabOn) { leavePresence(); return }
    joinPresence(id, { id: meId, name: myName })
    return () => leavePresence()
  }, [activeNote?.id, meId, myName, collabOn, joinPresence, leavePresence])

  // CO-EDIÇÃO (Fase 2): abre a sessão CRDT da nota ativa quando eu POSSO editar. O
  // collab-store carrega/semeia o Y.Doc, sincroniza ao vivo e chama onSnapshot (ytext →
  // notes.content) pra persistir + manter o Ops. Só-leitura / sem nome → não abre (fallback).
  useEffect(() => {
    const id = activeNote?.id
    const store = useCollabStore.getState()
    if (!id || !meId || !myName) { void store.close(); return }
    // Abre pra QUEM VÊ (editor ou só-leitura). editable=false: viewer só recebe ao vivo,
    // não semeia nem persiste; se não houver estado CRDT ainda, a sessão não abre (simples).
    const seed = activeNote?.content ?? ''
    void store.open(id, seed, { id: meId, name: myName }, async (noteId, markdown, persisted) => {
      const title = deriveTitle(markdown)
      if (!persisted) {
        const current = useNotesStore.getState().notes.find((note) => note.id === noteId)
        await saveDraft(noteId, {
          content: markdown,
          title: title || current?.title || '',
          savedAt: new Date().toISOString(),
        })
        return
      }
      const patch: { content: string; title?: string } = { content: markdown }
      if (title !== '') patch.title = title
      await useNotesStore.getState().updateNote(noteId, patch)
      void useNotesStore.getState().notifyMentions(noteId)
      void useEditsStore.getState().recordNoteEdit(noteId)
    }, !isReadOnly)
    return () => { void store.close() }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeNote?.id, isReadOnly, meId, myName])

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

  // Reposiciona o menu do botão direito pra NÃO cortar na borda da tela (flip/clamp).
  useLayoutEffect(() => {
    const el = menuRef.current
    if (!contextMenu || !el) return
    const rect = el.getBoundingClientRect()
    const m = 8
    let left = contextMenu.x
    let top = contextMenu.y
    if (left + rect.width > window.innerWidth - m) left = Math.max(m, window.innerWidth - rect.width - m)
    if (top + rect.height > window.innerHeight - m) top = Math.max(m, window.innerHeight - rect.height - m)
    el.style.left = `${left}px`
    el.style.top = `${top}px`
  }, [contextMenu])

  // Deep-link da @menção: quando ESTA nota é o alvo do flash, acha "@meuNome" e pisca a linha.
  useEffect(() => {
    if (!flashMentionNoteId || !activeNote || activeNote.id !== flashMentionNoteId) return
    if (!myName) { setFlashMentionNoteId(null); return }
    const t = setTimeout(() => {
      editorRef.current?.flashText('@' + myName)
      setFlashMentionNoteId(null)
    }, 280) // deixa o editor montar o conteúdo da nota antes de buscar/rolar
    return () => clearTimeout(t)
  }, [flashMentionNoteId, activeNote, myName, setFlashMentionNoteId])

  // Aviso "mencionou quem não tem acesso" (decisão (a)) — o toast oferece compartilhar (c).
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<{ noteId: string; names: string[] }>).detail
      if (detail?.names?.length) setMentionNoAccess(detail)
    }
    document.addEventListener('mileto:mention-no-access', handler)
    return () => document.removeEventListener('mileto:mention-no-access', handler)
  }, [])

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
      {/* Presença ao vivo agora vive na NoteDetailBar (unificada com "última edição") —
          antes era um overlay flutuante que caía sobre os botões das Subnotas. */}
      <NoteDetailBar livePeers={barPeers} />

      <div className="relative flex flex-1 overflow-hidden">
        {subnoteSide === 'left' && <SubnoteTree />}
        <MarkdownEditor
          ref={editorRef}
          value={localContent}
          onChange={handleContentChange}
          onCursor={onCursor}
          onSelect={collabOn ? undefined : onSelect}
          remoteCursors={collabOn ? [] : remoteCursors}
          ytext={collabOn ? collabSession?.ytext : undefined}
          awareness={collabOn ? collabSession?.awareness : undefined}
          undoManager={collabOn ? collabSession?.undoManager : undefined}
          collabKey={collabOn && activeNote ? activeNote.id : undefined}
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

      <NoteMediaStrip
        noteId={activeNote.id}
        canEdit={!isReadOnly}
        onMentionImage={(m) => editorRef.current?.insertAtCursor(`{{img:${m.id.slice(0, 8)}}} `)}
      />

      {contextMenu && (
        <div
          ref={menuRef}
          className="fixed z-30 rounded-xl border"
          style={{ left: contextMenu.x, top: contextMenu.y, width: 232, maxHeight: 'calc(100vh - 16px)', overflowY: 'auto', backgroundColor: '#1e1e1e', borderColor: '#333333', boxShadow: '0 10px 30px rgba(0,0,0,0.4)', padding: 5 }}
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
              {/* ALINHAR — estilo WordPad. Aplica na(s) linha(s) da seleção. Atalhos:
                  Ctrl+L / Ctrl+E / Ctrl+R / Ctrl+J (mesmos do Word). */}
              <div style={{ padding: '3px 8px 4px', fontSize: 11, color: '#71717a' }}>Alinhar</div>
              <div className="flex" style={{ gap: 2, padding: '0 4px 4px' }}>
                {([
                  ['alignLeft', AlignLeft, 'Esquerda (Ctrl+L)'],
                  ['alignCenter', AlignCenter, 'Centro (Ctrl+E)'],
                  ['alignRight', AlignRight, 'Direita (Ctrl+R)'],
                  ['alignJustify', AlignJustify, 'Justificado (Ctrl+J)'],
                ] as [FormatKind, typeof Bold, string][]).map(([k, Ic, tip]) => (
                  <button key={k} title={tip} onMouseDown={(e) => { e.preventDefault(); applyFormat(k) }}
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

      {/* Aviso: mencionou quem não tem acesso → não notificou (a) + atalho compartilhar (c). */}
      {mentionNoAccess && (
        <div
          className="fixed z-40 flex items-center gap-3 rounded-xl border"
          style={{
            left: '50%', bottom: 84, transform: 'translateX(-50%)', maxWidth: 'min(90vw, 520px)',
            padding: '9px 10px 9px 13px', backgroundColor: '#1e1e1e', borderColor: '#3a3a3a',
            boxShadow: '0 12px 34px rgba(0,0,0,0.45)',
          }}
        >
          <AtSign size={15} style={{ color: '#93c5fd', flexShrink: 0 }} />
          <span style={{ fontSize: 12.5, color: '#d4d4d8' }}>
            <b style={{ color: '#e4e4e7' }}>{mentionNoAccess.names.join(', ')}</b>{' '}
            {mentionNoAccess.names.length > 1 ? 'não têm' : 'não tem'} acesso a esta nota — a menção não foi avisada.
          </span>
          <button
            onClick={() => {
              setSharePickerTarget({ kind: 'note', id: mentionNoAccess.noteId, label: activeNote.title || 'Nota' })
              setMentionNoAccess(null)
            }}
            className="flex shrink-0 items-center gap-1.5 rounded-lg transition-colors"
            style={{ padding: '5px 10px', fontSize: 12, fontWeight: 600, color: '#06120d', backgroundColor: '#10b981' }}
          >
            <Share2 size={13} /> Compartilhar
          </button>
          <button
            onClick={() => setMentionNoAccess(null)}
            className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md transition-colors hover:bg-zinc-800"
            style={{ color: '#8a8a8f' }}
            title="Fechar"
          >
            <XIcon size={14} />
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
