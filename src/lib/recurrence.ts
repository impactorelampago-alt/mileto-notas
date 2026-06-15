import type { Recurrence, RecurrenceType } from './types'

// Recorrência — espelha o Mileto Ops (tasks.recurrence jsonb + parent_template_id).
// Formato canônico: { type, weekday?(0-6), day?(1-31), month?(1-12) }.

export const RECURRENCE_TYPES: RecurrenceType[] = ['weekly', 'biweekly', 'monthly', 'yearly']

export const RECURRENCE_LABELS: Record<RecurrenceType, string> = {
  weekly: 'Semanal',
  biweekly: 'Quinzenal',
  monthly: 'Mensal',
  yearly: 'Anual',
}

export const WEEKDAY_LABELS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb']
export const MONTH_LABELS = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez']

/** Recorrência default ao escolher um tipo, baseada numa data de referência (hoje). */
export function defaultRecurrence(type: RecurrenceType, ref: Date): Recurrence {
  switch (type) {
    case 'weekly':
    case 'biweekly':
      return { type, weekday: ref.getDay() }
    case 'monthly':
      return { type, day: ref.getDate() }
    case 'yearly':
      return { type, day: ref.getDate(), month: ref.getMonth() + 1 }
  }
}

/** Texto curto resumindo a recorrência (ex.: "Toda semana · Seg"). */
export function recurrenceSummary(r: Recurrence | null): string {
  if (!r) return 'Não repete'
  switch (r.type) {
    case 'weekly':
      return `Toda semana${r.weekday != null ? ` · ${WEEKDAY_LABELS[r.weekday]}` : ''}`
    case 'biweekly':
      return `A cada 2 semanas${r.weekday != null ? ` · ${WEEKDAY_LABELS[r.weekday]}` : ''}`
    case 'monthly':
      return `Todo mês${r.day != null ? ` · dia ${r.day}` : ''}`
    case 'yearly':
      return `Todo ano${r.day != null && r.month != null ? ` · ${r.day} de ${MONTH_LABELS[r.month - 1]}` : ''}`
    default:
      return 'Repete'
  }
}
