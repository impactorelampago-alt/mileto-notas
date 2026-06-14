/**
 * Categoria padrão nativa do Mileto Notas.
 *
 * O status de sistema TODO do Mileto Ops é exibido sempre como "Lembrete":
 * é a categoria padrão, não pode ser excluída e é o fallback de abertura.
 */
export const DEFAULT_SECTION_SUFFIX = 'TODO'
export const DEFAULT_SECTION_LABEL = 'Lembrete'

/** Rótulo de exibição da categoria (mapeia TODO → "Lembrete"). */
export function sectionDisplayLabel(suffix: string, label: string): string {
  return suffix === DEFAULT_SECTION_SUFFIX ? DEFAULT_SECTION_LABEL : label
}

/**
 * Comprimento do prefixo `USR_<idSemHifens>_` em uma key de custom_status.
 * 'USR_' (4) + uuid sem hífens (32) + '_' (1) = 37.
 */
export const CUSTOM_KEY_PREFIX_LEN = 37

/**
 * Retorna o prefixo `USR_<idSemHifens>_` (os 37 primeiros chars) de uma key
 * completa de custom_status, ou null se a key não começar com 'USR_'.
 */
export function ownerPrefixOfKey(fullKey: string): string | null {
  if (!fullKey.startsWith('USR_')) return null
  return fullKey.slice(0, CUSTOM_KEY_PREFIX_LEN)
}

/**
 * Dada uma key/status custom (`USR_<id>_<SUFIXO>`), retorna a key do status
 * DONE do MESMO dono (`USR_<id>_DONE`), ou null se não for uma key custom.
 */
export function doneKeyForStatus(status: string): string | null {
  if (!status.startsWith('USR_') || status.length < CUSTOM_KEY_PREFIX_LEN) return null
  return status.slice(0, CUSTOM_KEY_PREFIX_LEN) + 'DONE'
}

/**
 * True quando a key completa pertence ao usuário informado (id sem hífens),
 * i.e. começa com `USR_<cleanedUserId>_`.
 */
export function isCustomKeyOwnedBy(fullKey: string, cleanedUserId: string): boolean {
  return fullKey.startsWith(`USR_${cleanedUserId}_`)
}

// `suffixOfKey`/`isDoneStatus` foram movidos para `status-keys.ts` (helper
// canônico compartilhado byte-a-byte com o Mileto Ops): use getStatusBase /
// isDoneStatus / isStatusSuffix de lá.
