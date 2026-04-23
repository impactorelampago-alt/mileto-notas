import type { NotePriority } from './types'

export const NOTE_PRIORITY_ORDER: NotePriority[] = ['LOW', 'MEDIUM', 'HIGH', 'URGENT']

export const NOTE_PRIORITY_LABELS: Record<NotePriority, string> = {
  LOW: 'Prioridade baixa',
  MEDIUM: 'Prioridade média',
  HIGH: 'Prioridade alta',
  URGENT: 'Urgente',
}

export const NOTE_PRIORITY_COLORS: Record<NotePriority, { dot: string; bg: string; text: string; border: string }> = {
  LOW: {
    dot: '#10b981',
    bg: 'rgba(16, 185, 129, 0.12)',
    text: '#6ee7b7',
    border: 'rgba(16, 185, 129, 0.25)',
  },
  MEDIUM: {
    dot: '#f59e0b',
    bg: 'rgba(245, 158, 11, 0.14)',
    text: '#fcd34d',
    border: 'rgba(245, 158, 11, 0.25)',
  },
  HIGH: {
    dot: '#fb7185',
    bg: 'rgba(244, 63, 94, 0.14)',
    text: '#fda4af',
    border: 'rgba(244, 63, 94, 0.25)',
  },
  URGENT: {
    dot: '#ef4444',
    bg: 'rgba(239, 68, 68, 0.16)',
    text: '#fca5a5',
    border: 'rgba(239, 68, 68, 0.28)',
  },
}

export function normalizePriority(priority: string | null | undefined): NotePriority {
  if (priority === 'MEDIUM' || priority === 'HIGH' || priority === 'URGENT') return priority
  return 'LOW'
}

export function getNextPriority(priority: NotePriority): NotePriority {
  const currentIndex = NOTE_PRIORITY_ORDER.indexOf(priority)
  return NOTE_PRIORITY_ORDER[(currentIndex + 1) % NOTE_PRIORITY_ORDER.length]
}
