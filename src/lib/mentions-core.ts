// Detecção pura de @menções (sem depender de CodeMirror nem de stores) — usada
// tanto pelo editor (realce/autocomplete) quanto pela notes-store (notificar).

export interface MentionHit { userId: string; name: string; from: number; to: number }

/**
 * Acha as menções @Nome de MEMBROS DO TIME no texto. Casa o nome exato (aceita
 * espaços), com fronteira antes/depois (não casa email@x nem prefixo de outro
 * nome), preferindo o nome mais longo e sem sobreposição.
 */
export function findMentions(text: string, members: { id: string; name: string }[]): MentionHit[] {
  const sorted = [...members].filter((m) => m.name && m.name.trim()).sort((a, b) => b.name.length - a.name.length)
  const hits: MentionHit[] = []
  for (const m of sorted) {
    const needle = '@' + m.name
    let from = 0
    for (;;) {
      const idx = text.indexOf(needle, from)
      if (idx < 0) break
      from = idx + needle.length
      const before = idx > 0 ? text[idx - 1] : ' '
      const after = text[idx + needle.length] ?? ' '
      if (/[\p{L}\p{N}@]/u.test(before)) continue // @ colado em palavra / email
      if (/[\p{L}\p{N}]/u.test(after)) continue // o nome é prefixo de outro
      const to = idx + needle.length
      if (hits.some((h) => idx < h.to && to > h.from)) continue // sobreposição
      hits.push({ userId: m.id, name: m.name, from: idx, to })
    }
  }
  return hits
}
