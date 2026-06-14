/**
 * Mapa local (Notas-only) de "categoria de origem" de uma tarefa concluída.
 *
 * Quando o usuário conclui uma nota, a `tasks.status` vai pro DONE do dono
 * (reflete no kanban do Ops e dispara o sino). Mas no Notas a gente quer que a
 * nota CONTINUE aparecendo na categoria de onde foi concluída, marcada com ✓
 * verde. Para isso guardamos aqui o status de origem (chave: task_id) e o
 * TabBar/CategorySelect reagrupam a nota concluída na origem.
 *
 * É local por máquina (localStorage). Não vai pro banco — é só uma conveniência
 * de exibição do Notas; o estado "concluída" de verdade vive na `tasks.status`.
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
