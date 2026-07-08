// Núcleo CodeMirror 6 do editor de notas: tema dark, realce de markdown, "live
// preview" (esconde os marcadores **/_/# quando o cursor sai da linha), checkbox
// clicável, e auto-continuação de listas. Conteúdo continua texto-plano (markdown)
// — sync-safe com a description da task do Ops.
import { EditorView, Decoration, ViewPlugin, WidgetType } from '@codemirror/view'
import type { DecorationSet, ViewUpdate, KeyBinding } from '@codemirror/view'
import { EditorSelection } from '@codemirror/state'
import type { Range } from '@codemirror/state'
import { HighlightStyle, syntaxTree } from '@codemirror/language'
import { indentMore, indentLess } from '@codemirror/commands'
import { tags as t } from '@lezer/highlight'

// ── Tema dark do editor (casa com o #2d2d2d atual) ─────────────────────────────
export function editorTheme(fontSize: number): ReturnType<typeof EditorView.theme> {
  const lh = Math.round(fontSize * 1.7)
  return EditorView.theme(
    {
      '&': { backgroundColor: '#2d2d2d', color: '#cccccc', height: '100%', fontSize: `${fontSize}px` },
      '.cm-scroller': {
        fontFamily: "'JetBrains Mono', Consolas, monospace",
        lineHeight: `${lh}px`,
        padding: '22px 0',
        overflow: 'auto',
      },
      '.cm-content': { padding: '0 32px', caretColor: '#cccccc' },
      '.cm-line': { padding: '0' },
      '&.cm-focused': { outline: 'none' },
      '.cm-cursor': { borderLeftColor: '#cccccc' },
      '.cm-selectionBackground, ::selection': { backgroundColor: '#264f78 !important' },
      '&.cm-focused .cm-selectionBackground': { backgroundColor: '#264f78 !important' },
      '.cm-gutters': { backgroundColor: '#252526', color: '#6d6d6d', border: 'none', borderRight: '1px solid #353535' },
      '.cm-activeLineGutter': { backgroundColor: '#2d2d2d' },
      '.cm-activeLine': { backgroundColor: 'transparent' },
      '.cm-placeholder': { color: '#5a5a5a' },
      // checkbox clicável
      '.cm-md-check': {
        display: 'inline-block', width: '15px', height: '15px', verticalAlign: '-2px',
        marginRight: '2px', borderRadius: '4px', border: '1.5px solid #6b6b70',
        cursor: 'pointer', position: 'relative', boxSizing: 'border-box',
      },
      '.cm-md-check.done': { backgroundColor: '#10b981', borderColor: '#10b981' },
      '.cm-md-check.done::after': {
        content: '""', position: 'absolute', left: '4px', top: '1px', width: '4px', height: '8px',
        border: 'solid #04140e', borderWidth: '0 2px 2px 0', transform: 'rotate(45deg)',
      },
      // sublinhado (<u>) e marca-texto (==) — renderizados por decoração (regex)
      '.cm-md-u': { textDecoration: 'underline' },
      '.cm-md-hl': { backgroundColor: 'rgba(234, 179, 8, 0.28)', borderRadius: '2px', padding: '0 1px' },
      // bullet renderizado (• no lugar do "- ") + indentação das linhas de lista
      '.cm-md-bullet': { color: '#9a9aa0', marginRight: '0.5em' },
      '.cm-md-li': { paddingLeft: '1.3em' },
    },
    { dark: true },
  )
}

// ── Realce (negrito/itálico/título/código/citação/link/tachado/marca) ──────────
export const mdHighlight = HighlightStyle.define([
  { tag: t.heading1, color: '#e6e6e6', fontWeight: '700', fontSize: '1.5em' },
  { tag: t.heading2, color: '#e6e6e6', fontWeight: '700', fontSize: '1.3em' },
  { tag: t.heading3, color: '#e2e2e2', fontWeight: '700', fontSize: '1.15em' },
  { tag: [t.heading4, t.heading5, t.heading6], color: '#e2e2e2', fontWeight: '700' },
  { tag: t.strong, fontWeight: '700', color: '#f0f0f0' },
  { tag: t.emphasis, fontStyle: 'italic', color: '#e0e0e0' },
  { tag: t.strikethrough, textDecoration: 'line-through', color: '#8a8a8f' },
  { tag: [t.monospace], color: '#e0a0a0', backgroundColor: '#3a2a2a', borderRadius: '3px', padding: '0 3px' },
  { tag: t.link, color: '#5aa9e6', textDecoration: 'underline' },
  { tag: t.url, color: '#6d6d75' },
  { tag: t.quote, color: '#9aa0a6', fontStyle: 'italic' },
  { tag: [t.list], color: '#cccccc' },
  { tag: [t.processingInstruction, t.meta], color: '#6d6d75' }, // marcadores (**, #, -)
  { tag: t.contentSeparator, color: '#5a5a5a' }, // ---
])

// ── Widget de checkbox clicável ────────────────────────────────────────────────
class CheckboxWidget extends WidgetType {
  constructor(readonly checked: boolean, readonly pos: number) { super() }
  eq(o: CheckboxWidget) { return o.checked === this.checked && o.pos === this.pos }
  toDOM(view: EditorView): HTMLElement {
    const box = document.createElement('span')
    box.className = 'cm-md-check' + (this.checked ? ' done' : '')
    box.setAttribute('aria-label', this.checked ? 'Concluído' : 'A fazer')
    box.onmousedown = (e) => {
      e.preventDefault()
      if (view.state.readOnly) return
      // alterna o char dentro dos colchetes: [ ] <-> [x]
      const from = this.pos, to = this.pos + 1
      view.dispatch({ changes: { from, to, insert: this.checked ? ' ' : 'x' } })
    }
    return box
  }
  ignoreEvent() { return false }
}

// ── Widget de bullet (• no lugar do "- ") ──────────────────────────────────────
class BulletWidget extends WidgetType {
  eq() { return true }
  toDOM(): HTMLElement {
    const s = document.createElement('span')
    s.className = 'cm-md-bullet'
    s.textContent = '•'
    return s
  }
}

// ── Live preview: SEMPRE formatado (esconde os marcadores mesmo na linha ativa). O único
// que revela o cru é o LINK, quando o cursor o toca — pro duplo-clique editar a URL. ───
function buildDeco(view: EditorView): DecorationSet {
  const deco: Range<Decoration>[] = []
  const { state } = view
  const sel = state.selection

  // O cursor/seleção TOCA [from,to]? (usado SÓ pra revelar o LINK cru p/ edição da URL).
  const touches = (from: number, to: number): boolean => {
    for (const r of sel.ranges) if (r.from <= to && r.to >= from) return true
    return false
  }
  const isTaskLine = (text: string): boolean => /^\s*[-*+]\s+\[[ xX]\]/.test(text)

  const hide = Decoration.replace({})
  const uMark = Decoration.mark({ class: 'cm-md-u' })
  const hlMark = Decoration.mark({ class: 'cm-md-hl' })
  const liLine = Decoration.line({ attributes: { class: 'cm-md-li' } })
  const seenLi = new Set<number>()

  for (const { from, to } of view.visibleRanges) {
    syntaxTree(state).iterate({
      from, to,
      enter: (node) => {
        const name = node.name

        // Checkbox (item de tarefa): "[ ]"/"[x]" SEMPRE vira caixa clicável (nunca o cru).
        if (name === 'TaskMarker') {
          const checked = state.sliceDoc(node.from, node.to).toLowerCase().includes('x')
          deco.push(Decoration.replace({ widget: new CheckboxWidget(checked, node.from + 1) }).range(node.from, node.to))
          return
        }

        // Marcas INLINE (negrito/itálico/tachado/código): SEMPRE escondidas (já formatado).
        if (name === 'EmphasisMark' || name === 'StrikethroughMark' || name === 'CodeMark') {
          deco.push(hide.range(node.from, node.to))
          return
        }

        // Link [texto](url) → mostra só "texto" (estilizado), escondendo [ ] ( url ) quando
        // o cursor não toca o Link.
        if (name === 'LinkMark' || name === 'URL') {
          let a = node.node.parent
          while (a && a.name !== 'Link') a = a.parent
          if (a && !touches(a.from, a.to)) deco.push(hide.range(node.from, node.to))
          return
        }

        // Cabeçalho / citação (marcador de BLOCO): SEMPRE esconde "# "/"> ".
        if (name === 'HeaderMark' || name === 'QuoteMark') {
          let end = node.to
          if (state.sliceDoc(end, end + 1) === ' ') end += 1
          if (node.from < end) deco.push(hide.range(node.from, end))
          return
        }

        // Lista: indenta a linha e SEMPRE formata — bullet "-" vira "•"; o "- " do item de
        // tarefa some (o checkbox já marca o item); lista numerada mantém o número.
        if (name === 'ListMark') {
          const line = state.doc.lineAt(node.from)
          if (!seenLi.has(line.from)) { seenLi.add(line.from); deco.push(liLine.range(line.from)) }
          const mark = state.sliceDoc(node.from, node.to)
          let end = node.to
          if (state.sliceDoc(end, end + 1) === ' ') end += 1
          if (isTaskLine(line.text)) {
            deco.push(hide.range(node.from, end)) // "- " some; fica só o checkbox
          } else if (/^[-*+]$/.test(mark)) {
            deco.push(Decoration.replace({ widget: new BulletWidget() }).range(node.from, end))
          }
          return
        }
      },
    })

    // Sublinhado <u>…</u> e marca-texto ==…== (sem nó lezer): SEMPRE formatados.
    const startLine = state.doc.lineAt(from).number
    const endLine = state.doc.lineAt(to).number
    for (let n = startLine; n <= endLine; n++) {
      const line = state.doc.line(n)
      let m: RegExpExecArray | null
      const uRe = /<u>(.*?)<\/u>/g
      while ((m = uRe.exec(line.text))) {
        const s = line.from + m.index
        const innerStart = s + 3, innerEnd = innerStart + m[1].length, close = innerEnd + 4
        if (m[1].length > 0) deco.push(uMark.range(innerStart, innerEnd))
        deco.push(hide.range(s, innerStart)); deco.push(hide.range(innerEnd, close))
      }
      const hlRe = /==([^=\n]+)==/g
      while ((m = hlRe.exec(line.text))) {
        const s = line.from + m.index
        const innerStart = s + 2, innerEnd = innerStart + m[1].length, close = innerEnd + 2
        deco.push(hlMark.range(innerStart, innerEnd))
        deco.push(hide.range(s, innerStart)); deco.push(hide.range(innerEnd, close))
      }
    }
  }
  return Decoration.set(deco, true)
}

export const livePreview = ViewPlugin.fromClass(
  class {
    deco: DecorationSet
    constructor(view: EditorView) { this.deco = buildDeco(view) }
    update(u: ViewUpdate) {
      if (u.docChanged || u.selectionSet || u.viewportChanged) this.deco = buildDeco(u.view)
    }
  },
  { decorations: (v) => v.deco },
)

// ── Auto-continuação de listas / checklists no Enter ──────────────────────────
const LIST_RE = /^(\s*)(-\s\[[ xX]\]\s|[-*+]\s|\d+\.\s)(.*)$/
export const listKeymap: KeyBinding[] = [
  {
    key: 'Enter',
    run: (view: EditorView) => {
      const { state } = view
      if (state.readOnly) return false
      const range = state.selection.main
      if (!range.empty) return false
      const line = state.doc.lineAt(range.from)
      const m = LIST_RE.exec(line.text)
      if (!m) return false
      const [, indent, marker, rest] = m
      // Item vazio: encerra a lista (remove o marcador).
      if (rest.trim() === '' && range.from === line.to) {
        view.dispatch({ changes: { from: line.from, to: line.to, insert: indent }, selection: EditorSelection.cursor(line.from + indent.length) })
        return true
      }
      // Continua: novo item. Numerada incrementa; checkbox vira desmarcado.
      let next = marker
      const num = /^(\d+)\.\s$/.exec(marker)
      if (num) next = `${Number(num[1]) + 1}. `
      else if (/^\s*-\s\[[ xX]\]\s$/.test(marker) || /^-\s\[[ xX]\]\s$/.test(marker)) next = '- [ ] '
      const insert = '\n' + indent + next
      view.dispatch({ changes: { from: range.from, insert }, selection: EditorSelection.cursor(range.from + insert.length) })
      return true
    },
  },
]

// ── Tab: indenta (bom p/ aninhar listas) ou insere espaço no meio do texto ─────
export const tabKeymap: KeyBinding[] = [
  {
    key: 'Tab',
    run: (view: EditorView) => {
      if (view.state.readOnly) return false
      const r = view.state.selection.main
      if (r.empty) {
        const line = view.state.doc.lineAt(r.from)
        const before = view.state.sliceDoc(line.from, r.from)
        // Só espaços antes do cursor → indenta a linha (aninha lista); no meio → 2 espaços.
        if (/^\s*$/.test(before)) return indentMore(view)
        view.dispatch(view.state.replaceSelection('  '))
        return true
      }
      return indentMore(view) // seleção → indenta as linhas
    },
    shift: (view: EditorView) => {
      if (view.state.readOnly) return false
      return indentLess(view)
    },
  },
]

// ── Comandos de formatação (barra + atalhos + menu direito) ───────────────────
export type FormatKind =
  | 'bold' | 'italic' | 'underline' | 'strike' | 'code' | 'highlight'
  | 'h1' | 'h2' | 'quote' | 'ul' | 'ol' | 'checklist' | 'divider' | 'link' | 'today'

function wrap(view: EditorView, before: string, after = before): void {
  const changes = view.state.changeByRange((range) => {
    const sel = view.state.sliceDoc(range.from, range.to)
    const insert = before + sel + after
    return {
      changes: { from: range.from, to: range.to, insert },
      range: sel
        ? EditorSelection.range(range.from + before.length, range.from + before.length + sel.length)
        : EditorSelection.cursor(range.from + before.length),
    }
  })
  view.dispatch(changes, { scrollIntoView: true })
}

function prefixLines(view: EditorView, makePrefix: (i: number) => string): void {
  const { state } = view
  const sel = state.selection.main
  const startLine = state.doc.lineAt(sel.from).number
  const endLine = state.doc.lineAt(sel.to).number
  const parts: { from: number; insert: string }[] = []
  let i = 0
  for (let n = startLine; n <= endLine; n++) {
    const line = state.doc.line(n)
    parts.push({ from: line.from, insert: makePrefix(i++) })
  }
  const cs = state.changes(parts)
  // Mapeia a seleção original PELO changeset (assoc=1 = depois do prefixo inserido),
  // pra o cursor ficar DEPOIS do marcador e não selecioná-lo.
  view.dispatch({
    changes: cs,
    selection: EditorSelection.range(cs.mapPos(sel.from, 1), cs.mapPos(sel.to, 1)),
    scrollIntoView: true,
  })
}

export function applyFormat(view: EditorView, kind: FormatKind): void {
  if (view.state.readOnly) { view.focus(); return }
  switch (kind) {
    case 'bold': wrap(view, '**'); break
    case 'italic': wrap(view, '_'); break
    case 'underline': wrap(view, '<u>', '</u>'); break
    case 'strike': wrap(view, '~~'); break
    case 'code': wrap(view, '`'); break
    case 'highlight': wrap(view, '=='); break
    case 'h1': prefixLines(view, () => '# '); break
    case 'h2': prefixLines(view, () => '## '); break
    case 'quote': prefixLines(view, () => '> '); break
    case 'ul': prefixLines(view, () => '- '); break
    case 'ol': prefixLines(view, (i) => `${i + 1}. `); break
    case 'checklist': prefixLines(view, () => '- [ ] '); break
    case 'divider': {
      const pos = view.state.selection.main.to
      const line = view.state.doc.lineAt(pos)
      const insert = (line.text ? '\n' : '') + '\n---\n'
      view.dispatch({ changes: { from: line.to, insert }, selection: EditorSelection.cursor(line.to + insert.length) })
      break
    }
    case 'link': {
      // Com seleção: [texto](url) e seleciona "url" pra digitar. Sem: [|](url).
      const r = view.state.selection.main
      const text = view.state.sliceDoc(r.from, r.to)
      if (text) {
        const insert = `[${text}](url)`
        const urlFrom = r.from + text.length + 3 // depois de "]("
        view.dispatch({ changes: { from: r.from, to: r.to, insert }, selection: EditorSelection.range(urlFrom, urlFrom + 3), scrollIntoView: true })
      } else {
        view.dispatch({ changes: { from: r.from, insert: '[](url)' }, selection: EditorSelection.cursor(r.from + 1) })
      }
      break
    }
    case 'today': {
      const d = new Date().toLocaleDateString('pt-BR')
      view.dispatch(view.state.replaceSelection(d))
      break
    }
  }
  view.focus()
}
