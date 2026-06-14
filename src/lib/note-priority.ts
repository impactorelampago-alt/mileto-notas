import type { NotePriority } from './types'

export const NOTE_PRIORITY_ORDER: NotePriority[] = ['LOW', 'MEDIUM', 'HIGH', 'URGENT']

export const NOTE_PRIORITY_LABELS: Record<NotePriority, string> = {
  LOW: 'Baixa',
  MEDIUM: 'Média',
  HIGH: 'Alta',
  URGENT: 'Urgente',
}

export const NOTE_PRIORITY_COLORS: Record<NotePriority, { dot: string; bg: string; text: string; border: string }> = {
  LOW: {
    dot: '#a5b4fc',
    bg: 'rgba(165, 180, 252, 0.12)',
    text: '#c7d2fe',
    border: 'rgba(165, 180, 252, 0.25)',
  },
  MEDIUM: {
    dot: '#eab308',
    bg: 'rgba(234, 179, 8, 0.14)',
    text: '#fde047',
    border: 'rgba(234, 179, 8, 0.25)',
  },
  HIGH: {
    dot: '#f97316',
    bg: 'rgba(249, 115, 22, 0.14)',
    text: '#fdba74',
    border: 'rgba(249, 115, 22, 0.25)',
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
