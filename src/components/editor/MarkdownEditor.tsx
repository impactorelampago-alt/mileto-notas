import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react'
import {
  EditorView, keymap, lineNumbers, drawSelection, placeholder as cmPlaceholder,
  Decoration, WidgetType, type DecorationSet,
} from '@codemirror/view'
import { EditorState, Compartment, Annotation, StateField, StateEffect, Prec } from '@codemirror/state'
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { syntaxHighlighting, syntaxTree } from '@codemirror/language'
import { autocompletion, completionKeymap } from '@codemirror/autocomplete'
import type { SyntaxNode } from '@lezer/common'
import {
  editorTheme, mdHighlight, livePreview, listKeymap, tabKeymap, applyFormat as doFormat, type FormatKind,
} from './markdown-cm'
import { mentionCompletionSource, mentionHighlight, flashField, flashLineEffect, tokenDeleteKeymap } from './mentions'
import { yCollab, yUndoManagerKeymap } from 'y-codemirror.next'
import type * as Y from 'yjs'
import type { Awareness } from 'y-protocols/awareness'

export interface MarkdownEditorHandle {
  applyFormat: (kind: FormatKind) => void
  focus: () => void
  selectAll: () => void
  getSelection: () => { text: string; from: number; to: number }
  insertAtCursor: (text: string) => void
  /** Acha `needle` no texto, rola até a linha e a pisca (~1,5s). Deep-link da menção. */
  flashText: (needle: string) => void
}

export interface RemoteCursor { userId: string; name: string; color: string; anchor: number; head: number }

interface Props {
  value: string
  onChange: (v: string) => void
  onCursor: (line: number, col: number) => void
  onContextMenu: (info: { x: number; y: number; hasSelection: boolean; text: string; from: number; to: number }) => void
  onPasteImage: (files: File[]) => boolean
  readOnly: boolean
  showLineNumbers: boolean
  wordWrap: boolean
  fontSize: number
  placeholder?: string
  /** Cursores/seleções de OUTRAS pessoas na mesma nota (presença colaborativa — Fase 1). */
  remoteCursors?: RemoteCursor[]
  /** Seleção local mudou (anchor/head no doc) — pra transmitir a presença. */
  onSelect?: (anchor: number, head: number) => void
  /** CO-EDIÇÃO (Fase 2): Y.Text ligado ao doc via yCollab (merge CRDT). Se presente, o
   *  Yjs é a fonte do documento (sem value/value-sync). Ausente → modo simples. */
  ytext?: Y.Text
  awareness?: Awareness
  undoManager?: Y.UndoManager
  /** Muda quando a sessão colaborativa da nota muda → recria a view (yCollab é fixado
   *  na criação). `undefined` no modo simples = view persiste (comportamento atual). */
  collabKey?: string
}

// Marca transações que vêm de fora (sync do value) pra NÃO disparar onChange e não
// entrar em loop com o salvamento.
const External = Annotation.define<boolean>()

// ── Presença colaborativa: cursor + etiqueta de nome das outras pessoas ──────────
const setRemoteCursorsEffect = StateEffect.define<RemoteCursor[]>()

class RemoteCaretWidget extends WidgetType {
  constructor(readonly name: string, readonly color: string) { super() }
  eq(o: RemoteCaretWidget) { return o.name === this.name && o.color === this.color }
  toDOM() {
    const w = document.createElement('span')
    w.className = 'cm-remote-caret'
    w.style.setProperty('--rc', this.color)
    const label = document.createElement('span')
    label.className = 'cm-remote-caret-label'
    label.textContent = this.name
    w.appendChild(label)
    return w
  }
  ignoreEvent() { return true }
}

const remoteCursorsField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(deco, tr) {
    deco = deco.map(tr.changes)
    for (const e of tr.effects) {
      if (e.is(setRemoteCursorsEffect)) {
        const len = tr.state.doc.length
        const ranges = []
        for (const c of e.value) {
          const head = Math.max(0, Math.min(c.head, len))
          const anchor = Math.max(0, Math.min(c.anchor, len))
          const from = Math.min(anchor, head)
          const to = Math.max(anchor, head)
          if (to > from) {
            ranges.push(Decoration.mark({ attributes: { style: `background-color:${c.color}2e` } }).range(from, to))
          }
          ranges.push(Decoration.widget({ widget: new RemoteCaretWidget(c.name, c.color), side: 1 }).range(head))
        }
        deco = Decoration.set(ranges, true)
      }
    }
    return deco
  },
  provide: (f) => EditorView.decorations.from(f),
})

const remoteCaretTheme = EditorView.baseTheme({
  '.cm-remote-caret': {
    position: 'relative',
    borderLeft: '2px solid var(--rc)',
    marginLeft: '-1px',
    marginRight: '-1px',
    pointerEvents: 'none',
  },
  '.cm-remote-caret-label': {
    position: 'absolute',
    top: '-1.35em',
    left: '-1px',
    backgroundColor: 'var(--rc)',
    color: '#fff',
    fontSize: '10px',
    lineHeight: '1.35',
    padding: '0 4px',
    borderRadius: '3px 3px 3px 0',
    whiteSpace: 'nowrap',
    fontWeight: '600',
    zIndex: '20',
    userSelect: 'none',
  },
})

// URL que cobre `pos` (ou null). Usado pro clique-abre-link. Cobre: link [texto](url),
// URL "nua" (autolink GFM: http://…, www.…, email) e <url> (angle). Imagem markdown
// ![alt](url) NÃO abre pelo clique (retorna null).
function linkUrlAt(state: EditorState, pos: number): string | null {
  const inner: SyntaxNode | null = syntaxTree(state).resolveInner(pos, 0)
  // 1) Contexto mais próximo: Link (clicável) ou Image (não abre)?
  let ctx: SyntaxNode | null = inner
  while (ctx && ctx.name !== 'Link' && ctx.name !== 'Image') ctx = ctx.parent
  if (ctx?.name === 'Image') return null
  if (ctx?.name === 'Link') {
    let child: SyntaxNode | null = ctx.firstChild
    while (child) {
      if (child.name === 'URL') return state.sliceDoc(child.from, child.to).trim()
      child = child.nextSibling
    }
    return null
  }
  // 2) URL nua / autolink (sem Link/Image por cima) — remove os <> do angle autolink.
  let u: SyntaxNode | null = inner
  while (u && u.name !== 'URL' && u.name !== 'Autolink') u = u.parent
  if (u) return state.sliceDoc(u.from, u.to).replace(/^<|>$/g, '').trim()
  return null
}

// Abre a URL no navegador padrão. O main.ts intercepta window.open via
// setWindowOpenHandler → shell.openExternal. Só http(s)/mailto ou domínio nu (→ https);
// esquemas perigosos (javascript:, file:) e o placeholder "url" são ignorados.
function openExternalUrl(raw: string): void {
  let url = raw.trim()
  if (!url) return
  if (!/^(https?:|mailto:)/i.test(url)) {
    if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(url)) url = 'mailto:' + url   // email nu → mailto:
    else if (/^[\w-]+(\.[\w-]+)+/.test(url)) url = 'https://' + url     // domínio nu → https://
    else return
  }
  window.open(url, '_blank', 'noopener,noreferrer')
}

const MarkdownEditor = forwardRef<MarkdownEditorHandle, Props>(function MarkdownEditor(props, ref) {
  const parent = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)
  const propsRef = useRef(props)
  propsRef.current = props

  const themeC = useRef(new Compartment())
  const roC = useRef(new Compartment())
  const lnC = useRef(new Compartment())
  const wrapC = useRef(new Compartment())
  // Timer p/ distinguir clique simples (abre link) de duplo-clique (edita).
  const linkTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useImperativeHandle(ref, () => ({
    applyFormat: (kind) => { if (viewRef.current) doFormat(viewRef.current, kind) },
    focus: () => viewRef.current?.focus(),
    selectAll: () => {
      const v = viewRef.current
      if (v) { v.dispatch({ selection: { anchor: 0, head: v.state.doc.length } }); v.focus() }
    },
    getSelection: () => {
      const v = viewRef.current
      if (!v) return { text: '', from: 0, to: 0 }
      const r = v.state.selection.main
      return { text: v.state.sliceDoc(r.from, r.to), from: r.from, to: r.to }
    },
    insertAtCursor: (text) => {
      const v = viewRef.current
      if (!v || v.state.readOnly) return
      v.dispatch(v.state.replaceSelection(text))
      v.focus()
    },
    flashText: (needle) => {
      const v = viewRef.current
      if (!v || !needle) return
      const idx = v.state.doc.toString().indexOf(needle)
      if (idx < 0) return
      const line = v.state.doc.lineAt(idx)
      v.dispatch({ effects: [flashLineEffect.of({ from: line.from }), EditorView.scrollIntoView(idx, { y: 'center' })] })
      window.setTimeout(() => viewRef.current?.dispatch({ effects: flashLineEffect.of(null) }), 1600)
    },
  }))

  // Cria a view UMA vez.
  useEffect(() => {
    if (!parent.current) return
    const formatShortcuts = [
      { key: 'Mod-b', run: (v: EditorView) => { doFormat(v, 'bold'); return true } },
      { key: 'Mod-i', run: (v: EditorView) => { doFormat(v, 'italic'); return true } },
      { key: 'Mod-u', run: (v: EditorView) => { doFormat(v, 'underline'); return true } },
      // Alinhamento — mesmos atalhos do Word/WordPad.
      { key: 'Mod-l', run: (v: EditorView) => { doFormat(v, 'alignLeft'); return true } },
      { key: 'Mod-e', run: (v: EditorView) => { doFormat(v, 'alignCenter'); return true } },
      { key: 'Mod-r', run: (v: EditorView) => { doFormat(v, 'alignRight'); return true } },
      { key: 'Mod-j', run: (v: EditorView) => { doFormat(v, 'alignJustify'); return true } },
    ]
    const collab = propsRef.current.ytext
    const baseExtensions = [
        lnC.current.of(propsRef.current.showLineNumbers ? lineNumbers() : []),
        history(),
        drawSelection(),
        cmPlaceholder(propsRef.current.placeholder ?? ''),
        // Enter/listas ficam com o listKeymap nosso. Desligamos 2 parsers que transformam texto
        // comum de forma INESPERADA num app de notas (verificado headless que não quebram nada):
        //  • SetextHeading — "texto" + linha de '-'/'='/'---' embaixo NÃO vira título. O usuário
        //    quer que "-" comece LISTA e "---" seja DIVISOR; título é só via #/##.
        //  • IndentedCode — indentar 4 espaços / um Tab NÃO vira bloco de código (código é só via
        //    crase inline ou ``` fenced). Lista/continuação/aninhada/fenced/inline seguem OK.
        markdown({ base: markdownLanguage, addKeymap: false, extensions: [{ remove: ['SetextHeading', 'IndentedCode'] }] }),
        syntaxHighlighting(mdHighlight),
        livePreview,
        mentionHighlight,
        flashField,
        remoteCursorsField,
        remoteCaretTheme,
        autocompletion({ override: [mentionCompletionSource], defaultKeymap: false, icons: false }),
        wrapC.current.of(propsRef.current.wordWrap ? EditorView.lineWrapping : []),
        themeC.current.of(editorTheme(propsRef.current.fontSize)),
        roC.current.of([
          EditorState.readOnly.of(propsRef.current.readOnly),
          EditorView.editable.of(!propsRef.current.readOnly),
        ]),
        keymap.of([...completionKeymap, ...listKeymap, ...tabKeymap, ...tokenDeleteKeymap, ...formatShortcuts, ...defaultKeymap, ...historyKeymap]),
        EditorView.updateListener.of((u) => {
          const isExternal = u.transactions.some((tr) => tr.annotation(External))
          if (u.docChanged && !isExternal) {
            propsRef.current.onChange(u.state.doc.toString())
          }
          if (u.selectionSet || u.docChanged) {
            const main = u.state.selection.main
            const line = u.state.doc.lineAt(main.head)
            propsRef.current.onCursor(line.number, main.head - line.from + 1)
            propsRef.current.onSelect?.(main.anchor, main.head)
          }
        }),
        EditorView.domEventHandlers({
          paste: (e) => {
            const items = e.clipboardData?.items
            if (!items) return false
            const files: File[] = []
            for (let i = 0; i < items.length; i++) {
              const it = items[i]
              if (it.kind === 'file' && it.type.startsWith('image/')) {
                const f = it.getAsFile()
                if (f) files.push(f)
              }
            }
            if (files.length > 0 && propsRef.current.onPasteImage(files)) {
              e.preventDefault()
              return true
            }
            return false
          },
          contextmenu: (e, view) => {
            e.preventDefault()
            const r = view.state.selection.main
            propsRef.current.onContextMenu({
              x: e.clientX, y: e.clientY,
              hasSelection: !r.empty,
              text: view.state.sliceDoc(r.from, r.to),
              from: r.from, to: r.to,
            })
            return true
          },
          // Clique num link: 1x abre no navegador, 2x edita (coloca o cursor, revela o raw).
          mousedown: (e, view) => {
            // Botão direito NÃO move o cursor/seleção — assim a formatação escolhida no menu
            // (aberto pelo 'contextmenu') é aplicada onde o texto já estava, não no clique.
            if (e.button === 2) { e.preventDefault(); return true }
            if (e.button !== 0) return false
            const pos = view.posAtCoords({ x: e.clientX, y: e.clientY })
            if (pos == null) return false
            const url = linkUrlAt(view.state, pos)
            if (!url) return false
            e.preventDefault() // não posiciona cursor / não seleciona sobre o link
            if (e.detail === 1) {
              if (linkTimer.current) clearTimeout(linkTimer.current)
              // atrasa pra ver se vem um 2º clique (duplo = editar)
              linkTimer.current = setTimeout(() => { linkTimer.current = null; openExternalUrl(url) }, 250)
            }
            return true
          },
          dblclick: (e, view) => {
            const pos = view.posAtCoords({ x: e.clientX, y: e.clientY })
            if (pos == null || !linkUrlAt(view.state, pos)) return false
            if (linkTimer.current) { clearTimeout(linkTimer.current); linkTimer.current = null }
            e.preventDefault()
            view.dispatch({ selection: { anchor: pos } }) // cursor no link → revela o raw p/ editar
            view.focus()
            return true
          },
        }),
    ]
    // yCollab liga o doc ao CRDT (merge automático + cursores por awareness). Só no modo
    // colaborativo; a view é recriada quando a sessão muda (dep collabKey). FALLBACK: se o
    // yCollab falhar ao iniciar, cria a view SIMPLES → a edição nunca quebra.
    const mkState = (useCollab: boolean) => EditorState.create({
      doc: useCollab && collab ? collab.toString() : propsRef.current.value,
      extensions: useCollab && collab
        ? [
            yCollab(collab, propsRef.current.awareness ?? null, { undoManager: propsRef.current.undoManager ?? false }),
            // Ctrl+Z/Ctrl+Y → undo/redo do Yjs (só as MINHAS edições), com precedência
            // ALTA pra ganhar do history() do CodeMirror (que fica inerte no colab).
            Prec.highest(keymap.of(yUndoManagerKeymap)),
            ...baseExtensions,
          ]
        : baseExtensions,
    })
    let view: EditorView
    try {
      view = new EditorView({ state: mkState(!!collab), parent: parent.current })
    } catch (err) {
      console.error('[collab] yCollab init falhou — editor simples:', err)
      view = new EditorView({ state: mkState(false), parent: parent.current })
    }
    viewRef.current = view
    return () => {
      if (linkTimer.current) clearTimeout(linkTimer.current)
      view.destroy(); viewRef.current = null
    }
    // Recria a view quando a sessão colaborativa muda (entra/sai do colab, ou troca de
    // nota no colab). No modo simples collabKey é undefined → cria uma vez só.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.collabKey])

  // Sincroniza value externo (troca de nota / realtime / sync do Ops) → doc.
  // NO COLAB isto NÃO roda: o Yjs é a fonte do documento (o value é ignorado).
  useEffect(() => {
    if (propsRef.current.ytext) return
    const view = viewRef.current
    if (!view) return
    const cur = view.state.doc.toString()
    if (props.value !== cur) {
      view.dispatch({
        changes: { from: 0, to: cur.length, insert: props.value },
        annotations: External.of(true),
      })
    }
  }, [props.value])

  // Reconfigura compartimentos quando as props mudam.
  useEffect(() => {
    viewRef.current?.dispatch({ effects: roC.current.reconfigure([
      EditorState.readOnly.of(props.readOnly),
      EditorView.editable.of(!props.readOnly),
    ]) })
  }, [props.readOnly])
  useEffect(() => {
    viewRef.current?.dispatch({ effects: lnC.current.reconfigure(props.showLineNumbers ? lineNumbers() : []) })
  }, [props.showLineNumbers])
  useEffect(() => {
    viewRef.current?.dispatch({ effects: wrapC.current.reconfigure(props.wordWrap ? EditorView.lineWrapping : []) })
  }, [props.wordWrap])
  useEffect(() => {
    viewRef.current?.dispatch({ effects: themeC.current.reconfigure(editorTheme(props.fontSize)) })
  }, [props.fontSize])

  // Cursores/seleções das outras pessoas (presença) → redesenha as decorações.
  useEffect(() => {
    viewRef.current?.dispatch({ effects: setRemoteCursorsEffect.of(props.remoteCursors ?? []) })
  }, [props.remoteCursors])

  return <div ref={parent} className="min-w-0 flex-1 overflow-hidden" style={{ opacity: props.readOnly ? 0.9 : 1 }} />
})

export default MarkdownEditor
