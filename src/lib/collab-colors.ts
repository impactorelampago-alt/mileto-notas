/**
 * Cor estável por usuário (para cursores/etiquetas de presença colaborativa).
 * Determinística: o mesmo id sempre gera a mesma cor em todos os clientes.
 */
export function colorForUser(userId: string): string {
  let h = 0
  for (let i = 0; i < userId.length; i++) {
    h = (h * 31 + userId.charCodeAt(i)) % 360
  }
  // Saturação/luminância fixas → cores vivas e legíveis no dark mode.
  return `hsl(${h}, 68%, 55%)`
}
