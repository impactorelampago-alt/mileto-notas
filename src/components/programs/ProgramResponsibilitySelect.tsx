import { UserRoundCheck } from 'lucide-react'
import type { SyntheticEvent } from 'react'
import { useAuthStore } from '../../stores/auth-store'
import {
  useProgramHistoryStore,
  type NotasProgram,
} from '../../stores/program-history-store'

interface ProgramResponsibilitySelectProps {
  program: NotasProgram
  compact?: boolean
}

export default function ProgramResponsibilitySelect({
  program,
  compact = false,
}: ProgramResponsibilitySelectProps) {
  const userId = useAuthStore((state) => state.user?.id ?? null)
  const assignmentAccess = useProgramHistoryStore((state) => state.assignmentAccess)
  const programmers = useProgramHistoryStore((state) => state.programmers)
  const assigning = useProgramHistoryStore((state) => state.assigningProgramIds.has(program.id))
  const assignProgram = useProgramHistoryStore((state) => state.assignProgram)

  const isLead = assignmentAccess === 'LEAD'
  const isCurrent = program.responsible_programmer_id === userId
  const canAssume = assignmentAccess === 'PROGRAMMER'
    && program.responsible_programmer_id === null
  const canSelect = isLead || (assignmentAccess === 'PROGRAMMER' && isCurrent)

  const stopPropagation = (event: SyntheticEvent) => event.stopPropagation()
  const label = program.responsible_programmer_name_snapshot || 'Sem responsável'
  const currentIsSelectable = program.responsible_programmer_id === null
    || programmers.some((item) => item.user_id === program.responsible_programmer_id)

  if (canAssume) {
    return (
      <button
        type="button"
        disabled={assigning || !userId}
        onClick={(event) => {
          event.stopPropagation()
          if (userId) void assignProgram(program.id, userId)
        }}
        className="inline-flex items-center gap-1 rounded-md disabled:opacity-50"
        style={{
          padding: compact ? '2px 5px' : '5px 8px',
          border: '1px solid rgba(52,211,153,0.3)',
          color: '#6ee7b7',
          backgroundColor: 'rgba(16,185,129,0.08)',
          fontSize: compact ? 9.5 : 11,
        }}
        title="Assumir este programa"
      >
        <UserRoundCheck size={compact ? 11 : 13} />
        Assumir
      </button>
    )
  }

  if (canSelect) {
    return (
      <select
        value={program.responsible_programmer_id ?? ''}
        disabled={assigning}
        onClick={stopPropagation}
        onPointerDown={stopPropagation}
        onChange={(event) => {
          event.stopPropagation()
          void assignProgram(program.id, event.target.value || null)
        }}
        className="rounded-md outline-none disabled:opacity-50"
        style={{
          maxWidth: compact ? 132 : 220,
          height: compact ? 24 : 30,
          padding: compact ? '0 5px' : '0 8px',
          color: '#d4d4d8',
          backgroundColor: '#27272a',
          border: '1px solid #3f3f46',
          fontSize: compact ? 9.5 : 11,
        }}
        aria-label="Responsável pelo programa"
      >
        {isLead && <option value="">Sem responsável</option>}
        {!currentIsSelectable && program.responsible_programmer_id && (
          <option value={program.responsible_programmer_id}>
            {label} (inativo)
          </option>
        )}
        {programmers.map((programmer) => (
          <option key={programmer.user_id} value={programmer.user_id}>
            {programmer.user_name}{programmer.is_lead ? ' (líder)' : ''}
          </option>
        ))}
      </select>
    )
  }

  return (
    <span
      className="inline-flex min-w-0 items-center gap-1"
      style={{ color: program.responsible_programmer_id ? '#a7f3d0' : '#71717a' }}
      title={`Responsável pelo programa: ${label}`}
    >
      <UserRoundCheck size={compact ? 11 : 13} className="shrink-0" />
      <span
        className="truncate"
        style={{ maxWidth: compact ? 112 : 220, fontSize: compact ? 9.5 : 11 }}
      >
        {compact ? label : `Responsável pelo programa: ${label}`}
      </span>
    </span>
  )
}
