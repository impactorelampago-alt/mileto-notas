/**
 * Mapa local (Notas-only) da "categoria de origem" de uma tarefa concluída.
 *
 * Quando o usuário conclui uma nota, a `tasks.status` vai pro DONE do dono e a
 * nota passa a aparecer na categoria "Concluído". Guardamos aqui o status de
 * ORIGEM (chave: task_id) só para o REABRIR devolver a nota à coluna de onde ela
 * saiu — o TabBar/Editor não usam mais isto para EXIBIR (exibem pelo status real).
 *
 * É local por máquina (localStorage). Não vai pro banco — é só uma conveniência
 * do Notas; o estado "concluída" de verdade vive na `tasks.status`.
 */
const KEY = 'notas:completed-origins'

export function loadCompletedOrigins(): Record<string, string> {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as unknown
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, string>) : {}
  } catch {
    return {}
  }
}

export function persistCompletedOrigins(map: Record<string, string>): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(map))
  } catch {
    // sem localStorage (improvável no renderer) — ignora.
  }
}
