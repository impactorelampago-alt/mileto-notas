const WINDOWS_RESERVED_NAME = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i

/** Gera um nome compatível com o Windows sem alterar o título exibido na nota. */
export function safeTxtBaseName(title: string): string {
  const cleaned = title
    .normalize('NFKC')
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/g, '')
    .slice(0, 120)
    .replace(/[. ]+$/g, '')

  if (!cleaned || WINDOWS_RESERVED_NAME.test(cleaned)) return 'Nota'
  return cleaned
}

/** O resultado do seletor nativo é normalizado para sempre gerar um TXT. */
export function ensureTxtExtension(filePath: string): string {
  return filePath.toLowerCase().endsWith('.txt') ? filePath : `${filePath}.txt`
}
