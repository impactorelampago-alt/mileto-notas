/**
 * Identidade canônica das categorias de status (kanban por usuário).
 *
 * Regra (compartilhada Mileto Ops + Mileto Notas, banco em comum):
 *   key = "USR_" + <uuid do usuário SEM hífens, 32 hex> + "_" + <SUFIXO>
 * O prefixo "USR_<32hex>_" tem SEMPRE 37 caracteres. O SUFIXO pode conter
 * underscores internos (ex.: "EM_ESPERA_2"), então ele NUNCA deve ser derivado
 * por split('_') — use sempre a key COMPLETA como identidade.
 *
 * Espelha `lib/status-keys.ts` do Mileto Ops — mesma regra nos dois apps.
 */

export const STATUS_USER_PREFIX = 'USR_'
/** 'USR_' (4) + 32 hex do uuid + '_' (1) = 37 chars. */
export const STATUS_PREFIX_LEN = 37
export const DONE_SUFFIX = 'DONE'

const SCOPED_KEY_RE = /^USR_[0-9a-fA-F]{32}_(.+)$/

/** uuid sem hífens (forma canônica usada nas keys). */
export function cleanUserId(userId: string): string {
  return userId.replace(/-/g, '')
}

/** Monta a key canônica de um usuário para um dado sufixo. */
export function buildStatusKey(userId: string, suffix: string): string {
  return `${STATUS_USER_PREFIX}${cleanUserId(userId)}_${suffix}`
}

/**
 * Sufixo lógico COMPLETO de uma key (preserva underscores internos).
 *   "USR_<32hex>_EM_ESPERA_2" -> "EM_ESPERA_2"
 *   "CUSTOM_DONE"             -> "DONE"
 *   "DONE"                    -> "DONE"
 * Nunca usa split('_') (quebraria com sufixo composto, ex.: IN_PROGRESS -> PROGRESS).
 */
export function getStatusBase(key: string): string {
  if (!key) return ''
  if (key.startsWith(STATUS_USER_PREFIX)) {
    const m = SCOPED_KEY_RE.exec(key)
    if (m) return m[1]
    // Key USR_ malformada (id fora do padrão 32 hex): preserva o sufixo composto.
    const parts = key.split('_')
    return parts.length >= 3 ? parts.slice(2).join('_') : ''
  }
  if (key.startsWith('CUSTOM_')) return key.slice(7)
  return key
}

/**
 * "Concluído" é identidade ESTRITA: o sufixo precisa ser exatamente "DONE".
 * NUNCA casar por endsWith('_DONE') — senão "NOT_DONE"/"ALMOST_DONE" seriam done.
 */
export function isDoneStatus(key: string): boolean {
  return getStatusBase(key) === DONE_SUFFIX
}

/** A key representa o sufixo lógico informado? (ex.: isStatusSuffix(s, 'TODO')) */
export function isStatusSuffix(key: string, suffix: string): boolean {
  return getStatusBase(key) === suffix
}
