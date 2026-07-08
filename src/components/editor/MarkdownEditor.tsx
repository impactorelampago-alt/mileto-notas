import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react'
import {
  EditorView, keymap, lineNumbers, drawSelection, placeholder as cmPlaceholder,
} from '@codemirror/view'
import { EditorState, Compartment, Annotation } from '@codemirror/state'
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { syntaxHighlighting, syntaxTree } from '@codemirror/language'
import type { SyntaxNode } from '@lezer/common'
import {
  editorTheme, mdHighlight, livePreview, listKeymap, tabKeymap, applyFormat as doFormat, type FormatKind,
} from './markdown-cm'

export interface MarkdownEditorHandle {
  applyFormat: (kind: FormatKind) => void
  focus: () => void
  selectAll: () => void
  getSelection: () => { text: string; from: number; to: number }
}

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
}

// Marca transações que vêm de fora (sync do value) pra NÃO disparar onChange e não
// entrar em loop com o salvamento.
const External = Annotation.define<boolean>()

// URL do Link markdown que cobre `pos` (ou null). Usado pro clique-abre-link.
function linkUrlAt(state: EditorState, pos: number): string | null {
  let node: SyntaxNode | null = syntaxTree(state).resolveInner(pos, 0)
  while (node && node.name !== 'Link') node = node.parent
  if (!node) return null
  let child: SyntaxNode | null = node.firstChild
  while (child) {
    if (child.name === 'URL') return state.sliceDoc(child.from, child.to).trim()
    child = child.nextSibling
  }
  return null
}

// Abre a URL no navegador padrão. O main.ts intercepta window.open via
// setWindowOpenHandler → shell.openExternal. Só http(s)/mailto ou domínio nu (→ https);
// esquemas perigosos (javascript:, file:) e o placeholder "url" são ignorados.
function openExternalUrl(raw: string): void {
  let url = raw.trim()
  if (!url) return
  if (!/^(https?:|mailto:)/i.test(url)) {
    if (/^[\w-]+(\.[\w-]+)+/.test(url)) url = 'https://' + url
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
  }))

  // Cria a view UMA vez.
  useEffect(() => {
    if (!parent.current) return
    const formatShortcuts = [
      { key: 'Mod-b', run: (v: EditorView) => { doFormat(v, 'bold'); return true } },
      { key: 'Mod-i', run: (v: EditorView) => { doFormat(v, 'italic'); return true } },
      { key: 'Mod-u', run: (v: EditorView) => { doFormat(v, 'underline'); return true } },
    ]
    const state = EditorState.create({
      doc: propsRef.current.value,
      extensions: [
        lnC.current.of(propsRef.current.showLineNumbers ? lineNumbers() : []),
        history(),
        drawSelection(),
        cmPlaceholder(propsRef.current.placeholder ?? ''),
        markdown({ base: markdownLanguage, addKeymap: false }), // Enter/listas ficam com o listKeymap nosso
        syntaxHighlighting(mdHighlight),
        livePreview,
        wrapC.current.of(propsRef.current.wordWrap ? EditorView.lineWrapping : []),
        themeC.current.of(editorTheme(propsRef.current.fontSize)),
        roC.current.of([
          EditorState.readOnly.of(propsRef.current.readOnly),
          EditorView.editable.of(!propsRef.current.readOnly),
        ]),
        keymap.of([...listKeymap, ...tabKeymap, ...formatShortcuts, ...defaultKeymap, ...historyKeymap]),
        EditorView.updateListener.of((u) => {
          const isExternal = u.transactions.some((tr) => tr.annotation(External))
          if (u.docChanged && !isExternal) {
            propsRef.current.onChange(u.state.doc.toString())
          }
          if (u.selectionSet || u.docChanged) {
            const head = u.state.selection.main.head
            const line = u.state.doc.lineAt(head)
            propsRef.current.onCursor(line.number, head - line.from + 1)
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
      ],
    })
    const view = new EditorView({ state, parent: parent.current })
    viewRef.current = view
    return () => {
      if (linkTimer.current) clearTimeout(linkTimer.current)
      view.destroy(); viewRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Sincroniza value externo (troca de nota / realtime / sync do Ops) → doc.
  useEffect(() => {
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

  return <div ref={parent} className="min-w-0 flex-1 overflow-hidden" style={{ opacity: props.readOnly ? 0.9 : 1 }} />
})

export default MarkdownEditor
