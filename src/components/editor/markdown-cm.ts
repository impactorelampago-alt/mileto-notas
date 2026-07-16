// Núcleo CodeMirror 6 do editor de notas: tema dark, realce de markdown, "live
// preview" (esconde os marcadores **/_/# quando o cursor sai da linha), checkbox
// clicável, e auto-continuação de listas. Conteúdo continua texto-plano (markdown)
// — sync-safe com a description da task do Ops.
import { EditorView, Decoration, ViewPlugin, WidgetType } from '@codemirror/view'
import type { DecorationSet, ViewUpdate, KeyBinding } from '@codemirror/view'
import { EditorSelection } from '@codemirror/state'
import type { Range, EditorState } from '@codemirror/state'
import { HighlightStyle, syntaxTree } from '@codemirror/language'
import { indentMore, indentLess } from '@codemirror/commands'
import { tags as t } from '@lezer/highlight'
import type { SyntaxNode } from '@lezer/common'

// ── Tema dark do editor (casa com o #2d2d2d atual) ─────────────────────────────
export function editorTheme(fontSize: number): ReturnType<typeof EditorView.theme> {
  const lh = Math.round(fontSize * 1.75)
  return EditorView.theme(
    {
      '&': { backgroundColor: '#2d2d2d', color: '#d4d4d4', height: '100%', fontSize: `${fontSize}px` },
      '.cm-scroller': {
        fontFamily: "'JetBrains Mono', 'Cascadia Code', 'SF Mono', Consolas, monospace",
        lineHeight: `${lh}px`,
        padding: '24px 0',
        overflow: 'auto',
      },
      '.cm-content': { padding: '0 34px', caretColor: '#e6e6e6' },
      '.cm-line': { padding: '0' },
      '&.cm-focused': { outline: 'none' },
      '.cm-cursor': { borderLeftColor: '#e6e6e6', borderLeftWidth: '2px' },
      '.cm-selectionBackground, ::selection': { backgroundColor: 'rgba(56, 92, 148, 0.5) !important' },
      '&.cm-focused .cm-selectionBackground': { backgroundColor: 'rgba(56, 92, 148, 0.65) !important' },
      '.cm-gutters': { backgroundColor: '#252526', color: '#5c5c62', border: 'none', borderRight: '1px solid #333338' },
      '.cm-activeLineGutter': { backgroundColor: 'transparent', color: '#8a8a92' },
      '.cm-activeLine': { backgroundColor: 'transparent' },
      '.cm-placeholder': { color: '#5a5a5f', fontStyle: 'italic' },
      // checkbox clicável
      '.cm-md-check': {
        display: 'inline-block', width: '16px', height: '16px', verticalAlign: '-3px',
        marginRight: '7px', borderRadius: '4px', border: '1.6px solid #5c5c64',
        cursor: 'pointer', position: 'relative', boxSizing: 'border-box',
        transition: 'border-color 120ms, background-color 120ms',
      },
      '.cm-md-check:hover': { borderColor: '#83838c' },
      '.cm-md-check.done': { backgroundColor: '#10b981', borderColor: '#10b981' },
      '.cm-md-check.done:hover': { backgroundColor: '#0ea774', borderColor: '#0ea774' },
      '.cm-md-check.done::after': {
        content: '""', position: 'absolute', left: '5px', top: '1.5px', width: '4px', height: '8px',
        border: 'solid #ffffff', borderWidth: '0 2px 2px 0', transform: 'rotate(45deg)',
      },
      // sublinhado (<u>) e marca-texto (==) — renderizados por decoração (regex)
      '.cm-md-u': {
        textDecoration: 'underline', textDecorationThickness: '1px',
        textUnderlineOffset: '2px', textDecorationColor: 'rgba(212,212,212,0.55)',
      },
      '.cm-md-hl': { backgroundColor: 'rgba(250, 204, 21, 0.22)', borderRadius: '3px', padding: '0.06em 0.24em' },
      // bullet renderizado (• no lugar do "- ") + indentação das linhas de lista
      '.cm-md-bullet': { color: '#7d7d86', marginRight: '0.55em' },
      // número recalculado da lista ordenada (casa com a cor do marcador literal)
      '.cm-md-onum': { color: '#6a6a72' },
      '.cm-md-li': { paddingLeft: '1.45em' },
      // citação (blockquote): barra à esquerda + recuo + fundo sutil
      '.cm-md-quote': { borderLeft: '3px solid #4b4b54', paddingLeft: '14px', backgroundColor: 'rgba(255,255,255,0.022)' },
      // alinhamento de texto (token {{c}}/{{r}}/{{j}} na linha; sem token = esquerda)
      '.cm-md-align-c': { textAlign: 'center' },
      '.cm-md-align-r': { textAlign: 'right' },
      '.cm-md-align-j': { textAlign: 'justify' },
      // divisor horizontal (---) → linha real
      '.cm-md-hr': { display: 'inline-block', width: '100%', height: '0', borderTop: '1px solid #4a4a52', verticalAlign: 'middle' },
      // chip de menção a imagem ({{img:id}}) — clicável, leva/piscando a imagem na faixa
      '.cm-img-chip': {
        display: 'inline-flex', alignItems: 'center', gap: '5px', padding: '0 7px',
        margin: '0 1px', height: '19px', verticalAlign: '-4px', borderRadius: '6px',
        border: '1px solid rgba(16,185,129,0.35)', backgroundColor: 'rgba(16,185,129,0.13)',
        color: '#6ee7b7', cursor: 'pointer', fontSize: '0.82em', fontWeight: '500', userSelect: 'none',
        transition: 'background-color 120ms',
      },
      '.cm-img-chip:hover': { backgroundColor: 'rgba(16,185,129,0.24)' },
      // menção @Nome de membro do time
      '.cm-mention': {
        color: '#93c5fd', backgroundColor: 'rgba(59,130,246,0.15)', borderRadius: '4px',
        padding: '0.06em 0.32em', fontWeight: '500',
      },
    },
    { dark: true },
  )
}

// ── Realce (negrito/itálico/título/código/citação/link/tachado/marca) ──────────
export const mdHighlight = HighlightStyle.define([
  { tag: t.heading1, color: '#f5f5f7', fontWeight: '700', fontSize: '1.55em' },
  { tag: t.heading2, color: '#eff0f2', fontWeight: '700', fontSize: '1.3em' },
  { tag: t.heading3, color: '#e9e9ec', fontWeight: '600', fontSize: '1.14em' },
  { tag: [t.heading4, t.heading5, t.heading6], color: '#e2e2e6', fontWeight: '600' },
  { tag: t.strong, fontWeight: '700', color: '#f4f4f6' },
  { tag: t.emphasis, fontStyle: 'italic', color: '#dcdce0' },
  { tag: t.strikethrough, textDecoration: 'line-through', color: '#7f7f88' },
  { tag: [t.monospace], color: '#e0b989', backgroundColor: 'rgba(255,255,255,0.07)', borderRadius: '4px', padding: '0.08em 0.34em' },
  { tag: t.link, color: '#6cb1ee', textDecoration: 'underline', textUnderlineOffset: '2px' },
  { tag: t.url, color: '#6cb1ee', textDecoration: 'underline', textUnderlineOffset: '2px' }, // URL nua = link
  { tag: t.quote, color: '#a2a2ab', fontStyle: 'italic' },
  { tag: [t.list], color: '#d4d4d4' },
  { tag: [t.processingInstruction, t.meta], color: '#6a6a72' }, // marcadores (**, #, -)
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

// ── Widget do número da lista ordenada (número CALCULADO, não o literal) ───────
class OrderMarkWidget extends WidgetType {
  constructor(readonly text: string) { super() }
  eq(o: OrderMarkWidget) { return o.text === this.text }
  toDOM(): HTMLElement {
    const s = document.createElement('span')
    s.className = 'cm-md-onum'
    s.textContent = this.text
    return s
  }
}

/** Número que ESTE item deveria exibir: número do 1º item da lista + a posição dele.
 *  É a semântica do markdown (o renderizador numera em sequência e ignora os números
 *  literais) — então a lista se reorganiza sozinha ao inserir/remover/mover item, sem
 *  precisar reescrever o texto do usuário. Retorna null se não for lista ordenada. */
function orderedMarkFor(state: EditorState, markNode: SyntaxNode, mark: string): string | null {
  const li = markNode.parent
  const ol = li?.parent
  if (!li || li.name !== 'ListItem' || !ol || ol.name !== 'OrderedList') return null
  let idx = 0
  let start = 1
  let first = true
  for (let sib: SyntaxNode | null = ol.firstChild; sib; sib = sib.nextSibling) {
    if (sib.name !== 'ListItem') continue
    if (first) {
      first = false
      let fm: SyntaxNode | null = sib.firstChild
      while (fm && fm.name !== 'ListMark') fm = fm.nextSibling
      if (fm) {
        const n = parseInt(state.sliceDoc(fm.from, fm.to), 10)
        if (!Number.isNaN(n)) start = n
      }
    }
    if (sib.from === li.from) return `${start + idx}${mark.slice(-1)}` // preserva "." ou ")"
    idx++
  }
  return null
}

// ── Widget de divisor horizontal (--- vira uma linha real) ─────────────────────
class HrWidget extends WidgetType {
  eq() { return true }
  toDOM(): HTMLElement {
    const s = document.createElement('span')
    s.className = 'cm-md-hr'
    s.setAttribute('aria-hidden', 'true')
    return s
  }
}

// ── Widget de menção a imagem ({{img:<id8>}}) ─────────────────────────────────
// Clicar dispara 'mileto:flash-image' (o NoteMediaStrip rola até a imagem e pisca).
// O token some (vira chip); o char continua no texto (some ao apagar por cima).
class ImageMentionWidget extends WidgetType {
  constructor(readonly id8: string) { super() }
  eq(o: ImageMentionWidget) { return o.id8 === this.id8 }
  toDOM(): HTMLElement {
    const chip = document.createElement('span')
    chip.className = 'cm-img-chip'
    chip.title = 'Ir para a imagem'
    chip.innerHTML =
      '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="1.6"/><path d="m21 15-4.5-4.5L5 21"/></svg><span>imagem</span>'
    chip.onmousedown = (e) => {
      e.preventDefault()
      document.dispatchEvent(new CustomEvent('mileto:flash-image', { detail: this.id8 }))
    }
    return chip
  }
  ignoreEvent() { return false }
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
  const quoteLine = Decoration.line({ attributes: { class: 'cm-md-quote' } })
  // Alinhamento por linha via token {{c}}/{{r}}/{{j}} (chaves não são sintaxe markdown →
  // não colidem com nada e não deslocam o "# "/"- " do início, que quebraria título/lista).
  const alignLine: Record<string, Decoration> = {
    c: Decoration.line({ attributes: { class: 'cm-md-align-c' } }),
    r: Decoration.line({ attributes: { class: 'cm-md-align-r' } }),
    j: Decoration.line({ attributes: { class: 'cm-md-align-j' } }),
  }
  const seenLi = new Set<number>()
  const seenQuote = new Set<number>()
  const seenAlign = new Set<number>()

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

        // Cabeçalho (marcador de BLOCO): SEMPRE esconde "# ".
        if (name === 'HeaderMark') {
          let end = node.to
          if (state.sliceDoc(end, end + 1) === ' ') end += 1
          if (node.from < end) deco.push(hide.range(node.from, end))
          return
        }

        // Citação: barra à esquerda na linha (blockquote) + esconde o "> ".
        if (name === 'QuoteMark') {
          const line = state.doc.lineAt(node.from)
          if (!seenQuote.has(line.from)) { seenQuote.add(line.from); deco.push(quoteLine.range(line.from)) }
          let end = node.to
          if (state.sliceDoc(end, end + 1) === ' ') end += 1
          if (node.from < end) deco.push(hide.range(node.from, end))
          return
        }

        // Divisor horizontal (---) → linha real. Revela o cru quando o cursor toca (p/ editar).
        if (name === 'HorizontalRule') {
          if (!touches(node.from, node.to)) {
            deco.push(Decoration.replace({ widget: new HrWidget() }).range(node.from, node.to))
          }
          return false
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
          } else if (/^\d+[.)]$/.test(mark)) {
            // Lista numerada: mostra o número CALCULADO pela posição (o que um renderizador
            // markdown faria) em vez do literal → a lista se reorganiza sozinha ao inserir/
            // remover/mover item. Só decora quando difere (o comum é não mexer em nada).
            const expected = orderedMarkFor(state, node.node, mark)
            if (expected && expected !== mark) {
              deco.push(Decoration.replace({ widget: new OrderMarkWidget(expected) }).range(node.from, node.to))
            }
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
      // Menção a imagem {{img:<id8>}} → chip clicável (o char continua no texto).
      const imgRe = /\{\{img:([0-9a-fA-F]{4,32})\}\}/g
      while ((m = imgRe.exec(line.text))) {
        const s = line.from + m.index
        deco.push(Decoration.replace({ widget: new ImageMentionWidget(m[1]) }).range(s, s + m[0].length))
      }
      // Alinhamento {{c}}/{{r}}/{{j}} → esconde o token (em QUALQUER posição da linha) e
      // alinha a LINHA toda. O 1º token manda; sem token = esquerda (padrão).
      const alignRe = /\{\{([crj])\}\}/g
      let alignKind: string | null = null
      while ((m = alignRe.exec(line.text))) {
        const s = line.from + m.index
        deco.push(hide.range(s, s + m[0].length))
        if (!alignKind) alignKind = m[1]
      }
      if (alignKind && !seenAlign.has(line.from)) {
        seenAlign.add(line.from)
        deco.push(alignLine[alignKind].range(line.from))
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
  | 'alignLeft' | 'alignCenter' | 'alignRight' | 'alignJustify'

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

/** Alinha a(s) linha(s) da seleção: troca o token {{c}}/{{r}}/{{j}} da linha (esquerda =
 *  sem token). Markdown não tem alinhamento — o token fica no texto (invisível no editor)
 *  e o Ops o esconde/aplica na descrição da tarefa. */
function setAlign(view: EditorView, kind: 'l' | 'c' | 'r' | 'j'): void {
  const { state } = view
  const sel = state.selection.main
  const startLine = state.doc.lineAt(sel.from).number
  const endLine = state.doc.lineAt(sel.to).number
  const changes: { from: number; to: number; insert: string }[] = []
  for (let n = startLine; n <= endLine; n++) {
    const line = state.doc.line(n)
    const cleaned = line.text.replace(/\{\{[crj]\}\}/g, '') // tira o alinhamento anterior
    const next = kind === 'l' ? cleaned : cleaned + `{{${kind}}}`
    if (next !== line.text) changes.push({ from: line.from, to: line.to, insert: next })
  }
  if (changes.length) view.dispatch({ changes, scrollIntoView: true })
}

export function applyFormat(view: EditorView, kind: FormatKind): void {
  if (view.state.readOnly) { view.focus(); return }
  switch (kind) {
    case 'alignLeft': setAlign(view, 'l'); break
    case 'alignCenter': setAlign(view, 'c'); break
    case 'alignRight': setAlign(view, 'r'); break
    case 'alignJustify': setAlign(view, 'j'); break
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
