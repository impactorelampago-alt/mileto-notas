// Identidade canônica das categorias de status (compartilhada Ops + Notas).
// key = "USR_" + uuid sem hífens (32 hex) + "_" + SUFIXO. Prefixo = 37 chars.
// SUFIXO pode ter "_" interno (EM_ESPERA_2) → NUNCA derive por split('_').
export const STATUS_USER_PREFIX = 'USR_'
export const STATUS_PREFIX_LEN = 37
export const DONE_SUFFIX = 'DONE'
const SCOPED_KEY_RE = /^USR_[0-9a-fA-F]{32}_(.+)$/

export function cleanUserId(userId: string): string {
  return userId.replace(/-/g, '')
}

export function buildStatusKey(userId: string, suffix: string): string {
  return `${STATUS_USER_PREFIX}${cleanUserId(userId)}_${suffix}`
}

export function getStatusBase(key: string): string {
  if (!key) return ''
  if (key.startsWith(STATUS_USER_PREFIX)) {
    const m = SCOPED_KEY_RE.exec(key)
    if (m) return m[1]
    const parts = key.split('_')
    return parts.length >= 3 ? parts.slice(2).join('_') : ''
  }
  if (key.startsWith('CUSTOM_')) return key.slice(7)
  return key
}

export function isDoneStatus(key: string): boolean {
  return getStatusBase(key) === DONE_SUFFIX
}

export function isStatusSuffix(key: string, suffix: string): boolean {
  return getStatusBase(key) === suffix
}
