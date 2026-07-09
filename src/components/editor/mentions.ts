// Menções @Nome: autocomplete do time, realce do @Nome no editor, detecção pra
// notificar, e o "flash" de linha usado pelo deep-link da notificação.
// Fica FORA do markdown-cm (que é puro) porque depende do auth-store (time).
import { EditorView, Decoration, ViewPlugin } from '@codemirror/view'
import type { DecorationSet, ViewUpdate } from '@codemirror/view'
import { StateField, StateEffect } from '@codemirror/state'
import type { CompletionContext, CompletionResult } from '@codemirror/autocomplete'
import { useAuthStore } from '../../stores/auth-store'
import { findMentions } from '../../lib/mentions-core'

/** Membros do time com nome exibível (id + nome). Lido ao vivo do auth-store. */
function teamMembers(): { id: string; name: string }[] {
  return useAuthStore
    .getState()
    .teamProfiles.filter((p) => p.name && p.name.trim())
    .map((p) => ({ id: p.id, name: (p.name as string).trim() }))
}

// ── Autocomplete do @ (lista o time) ───────────────────────────────────────────
export function mentionCompletionSource(context: CompletionContext): CompletionResult | null {
  const word = context.matchBefore(/@[\p{L}\p{N}_]*/u)
  if (!word) return null
  const team = teamMembers()
  if (team.length === 0) return null
  return {
    from: word.from,
    options: team.map((p) => ({ label: '@' + p.name, apply: '@' + p.name + ' ', type: 'keyword' })),
    validFor: /^@[\p{L}\p{N}_ ]*$/u,
  }
}

// ── Realce das menções (@Nome de membros do time) ──────────────────────────────
const mentionMark = Decoration.mark({ class: 'cm-mention' })
function mentionDeco(view: EditorView): DecorationSet {
  const hits = findMentions(view.state.doc.toString(), teamMembers())
  return Decoration.set(hits.map((h) => mentionMark.range(h.from, h.to)), true)
}
export const mentionHighlight = ViewPlugin.fromClass(
  class {
    deco: DecorationSet
    constructor(view: EditorView) { this.deco = mentionDeco(view) }
    update(u: ViewUpdate) { if (u.docChanged || u.viewportChanged) this.deco = mentionDeco(u.view) }
  },
  { decorations: (v) => v.deco },
)

// ── Flash de linha (deep-link da notificação de menção) ────────────────────────
// StateEffect que acende/apaga um realce na linha; o MarkdownEditor busca o
// "@meuNome", rola até lá, dispara o efeito e o limpa depois de ~1,5s.
export const flashLineEffect = StateEffect.define<{ from: number } | null>()
const flashLineDeco = Decoration.line({ attributes: { class: 'cm-flash-line' } })
export const flashField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(deco, tr) {
    deco = deco.map(tr.changes)
    for (const e of tr.effects) {
      if (e.is(flashLineEffect)) deco = e.value ? Decoration.set([flashLineDeco.range(e.value.from)]) : Decoration.none
    }
    return deco
  },
  provide: (f) => EditorView.decorations.from(f),
})
