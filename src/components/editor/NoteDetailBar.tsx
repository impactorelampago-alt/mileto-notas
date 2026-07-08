import { useMemo, useRef, useState, useEffect } from 'react'
import { Calendar, Building2, Repeat, Check, X, Search } from 'lucide-react'
import { useNotesStore } from '../../stores/notes-store'
import { useOpsStore } from '../../stores/ops-store'
import { useAuthStore } from '../../stores/auth-store'
import { NOTE_PRIORITY_COLORS, NOTE_PRIORITY_LABELS, normalizePriority } from '../../lib/note-priority'
import { sectionDisplayLabel } from '../../lib/sections'
import { isDoneStatus, getStatusBase } from '../../lib/status-keys'
import {
  RECURRENCE_TYPES, RECURRENCE_LABELS, WEEKDAY_LABELS, MONTH_LABELS,
  recurrenceSummary, defaultRecurrence,
} from '../../lib/recurrence'
import type { NotePriority, Recurrence } from '../../lib/types'

const PRIORITY_ORDER: NotePriority[] = ['URGENT', 'HIGH', 'MEDIUM', 'LOW']

type Pop = 'cat' | 'prio' | 'prazo' | 'empresa' | 'recorr' | null

const POP_BG = '#202020'
const POP_BORDER = '#353535'

/** Barra de detalhe da nota (espelha o detalhe da tarefa do Ops): Categoria ·
 * Prioridade · Prazo · Empresa · Recorrência. Fica entre as abas e o editor.
 * Tudo grava na TASK (fonte de verdade do Ops) via updateTaskFields / updateNote. */
export default function NoteDetailBar() {
  const activeNote = useNotesStore((s) => s.notes.find((n) => n.id === s.activeTabId) ?? null)
  const updateNote = useNotesStore((s) => s.updateNote)
  const sections = useOpsStore((s) => s.sections)
  const tasks = useOpsStore((s) => s.tasks)
  const clients = useOpsStore((s) => s.clients)
  const updateTaskFields = useOpsStore((s) => s.updateTaskFields)
  const setActiveSectionId = useOpsStore((s) => s.setActiveSectionId)
  const viewAll = useAuthStore((s) => s.viewAll)
  const isDono = useAuthStore((s) => s.isDono())

  const [pop, setPop] = useState<Pop>(null)
  const [clientSearch, setClientSearch] = useState('')
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!pop) return
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setPop(null)
    }
    window.addEventListener('mousedown', onDown)
    return () => window.removeEventListener('mousedown', onDown)
  }, [pop])

  const task = useMemo(
    () => (activeNote?.task_id ? tasks.find((t) => t.id === activeNote.task_id) ?? null : null),
    [activeNote?.task_id, tasks],
  )

  if (!activeNote) return null

  // Subnota: Empresa/Prazo/Prioridade vivem na PRÓPRIA nota (subnota não tem task).
  // Categoria e Recorrência são conceitos da task/board → ficam ocultos na subnota.
  const isSubnote = !!activeNote.parent_note_id

  // DONO tem controle total (prioridade/cliente/status de qualquer tarefa).
  const readOnly = !isDono && (viewAll || (!!activeNote.is_shared_with_me && activeNote.shared_permission !== 'EDIT'))
  const priority = normalizePriority(activeNote.priority)
  const pColors = NOTE_PRIORITY_COLORS[priority]
  const done = task ? isDoneStatus(task.status) : false

  // Categoria efetiva: concluída cai em "Concluído" (igual ao TabBar).
  const effStatus = task ? task.status : ''
  const curSection =
    sections.find((s) => s.key === effStatus) ??
    sections.find((s) => s.key_suffix === getStatusBase(effStatus)) ??
    null

  const dueRaw = isSubnote ? activeNote.due_date : (task?.due_date ?? null)
  const dueDate = dueRaw ? new Date(dueRaw) : null
  const dueInputValue = dueDate ? dueDate.toISOString().slice(0, 10) : ''
  const overdue = !!dueDate && !done && dueDate < new Date(new Date().toISOString().slice(0, 10))
  const dueLabel = dueDate ? dueDate.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' }) : 'Prazo'

  const clientId = isSubnote ? activeNote.client_id : (task?.client_id ?? null)
  const company = clientId ? clients.find((c) => c.id === clientId)?.company ?? null : null
  const rec = task?.recurrence ?? null

  const toggle = (p: Pop) => setPop((cur) => (cur === p ? null : p))
  const canEdit = !readOnly && !!task
  // Empresa/Prazo também valem pra SUBNOTA — gravam na própria nota (via updateNote),
  // já que a subnota não tem task. Na nota raiz continuam indo pra task.
  const canEditMeta = !readOnly && (isSubnote || !!task)
  const setClientId = (client_id: string | null) => {
    if (isSubnote) void updateNote(activeNote.id, { client_id })
    else if (task) void updateTaskFields(task.id, { client_id })
  }
  const setDueDate = (due_date: string | null) => {
    if (isSubnote) void updateNote(activeNote.id, { due_date })
    else if (task) void updateTaskFields(task.id, { due_date })
  }

  // ── chip base ──────────────────────────────────────────────────────────────
  const Chip = (props: {
    id: Pop; icon: React.ReactNode; label: string; active?: boolean; danger?: boolean; disabled?: boolean
  }) => (
    <button
      onClick={() => { if (!props.disabled) toggle(props.id) }}
      disabled={props.disabled}
      className="flex items-center rounded-md"
      style={{
        gap: 6, height: 26, padding: '0 9px', flexShrink: 0,
        fontSize: 12, fontWeight: 500,
        color: props.danger ? '#f87171' : props.active ? '#d1fae5' : '#9a9aa3',
        backgroundColor: pop === props.id ? '#333' : props.active ? 'rgba(16,185,129,0.10)' : 'transparent',
        border: `1px solid ${props.danger ? 'rgba(248,113,113,0.4)' : props.active ? 'rgba(16,185,129,0.28)' : '#333'}`,
        cursor: props.disabled ? 'default' : 'pointer',
        opacity: props.disabled ? 0.5 : 1,
        transition: 'background-color 120ms, border-color 120ms',
      }}
      onMouseEnter={(e) => { if (!props.disabled && pop !== props.id) e.currentTarget.style.backgroundColor = '#2a2a2a' }}
      onMouseLeave={(e) => { if (!props.disabled && pop !== props.id) e.currentTarget.style.backgroundColor = props.active ? 'rgba(16,185,129,0.10)' : 'transparent' }}
    >
      {props.icon}
      <span className="truncate" style={{ maxWidth: 160 }}>{props.label}</span>
    </button>
  )

  const popStyle: React.CSSProperties = {
    position: 'absolute', top: 'calc(100% + 6px)', left: 0, zIndex: 50,
    minWidth: 200, backgroundColor: POP_BG, border: `1px solid ${POP_BORDER}`,
    borderRadius: 10, boxShadow: '0 14px 36px rgba(0,0,0,0.5)', padding: 6,
  }

  return (
    <div
      ref={ref}
      className="flex items-center"
      style={{
        gap: 8, padding: '7px 12px', flexWrap: 'wrap',
        backgroundColor: '#262626', borderBottom: '1px solid #2a2a2a',
      }}
    >
      {/* CATEGORIA — só na nota raiz (subnota não fica no board do Ops) */}
      {!isSubnote && (
      <div className="relative" style={{ flexShrink: 0 }}>
        <Chip
          id="cat"
          icon={<span style={{ width: 9, height: 9, borderRadius: 999, backgroundColor: curSection?.color ?? '#52525b', flexShrink: 0 }} />}
          label={curSection ? sectionDisplayLabel(curSection.key_suffix, curSection.label) : 'Categoria'}
          active={!!curSection}
          disabled={!canEdit || done}
        />
        {pop === 'cat' && (
          <div style={{ ...popStyle, maxHeight: 320, overflowY: 'auto' }}>
            {sections.filter((s) => !s.shared).map((s) => {
              const cur = s.key_suffix === curSection?.key_suffix
              return (
                <button
                  key={s.key}
                  onClick={() => {
                    setPop(null)
                    if (task && s.key !== task.status) {
                      void updateTaskFields(task.id, { status: s.key })
                      setActiveSectionId(s.key_suffix)
                    }
                  }}
                  className="flex w-full items-center rounded-md text-left"
                  style={{ gap: 9, padding: '7px 9px', backgroundColor: cur ? 'rgba(16,185,129,0.10)' : 'transparent' }}
                  onMouseEnter={(e) => { if (!cur) e.currentTarget.style.backgroundColor = '#2a2a2a' }}
                  onMouseLeave={(e) => { if (!cur) e.currentTarget.style.backgroundColor = 'transparent' }}
                >
                  <span style={{ width: 9, height: 9, borderRadius: 999, backgroundColor: s.color, flexShrink: 0 }} />
                  <span className="flex-1 truncate" style={{ fontSize: 13, color: '#e4e4e7' }}>{sectionDisplayLabel(s.key_suffix, s.label)}</span>
                  {cur && <Check size={13} style={{ color: '#10b981' }} />}
                </button>
              )
            })}
          </div>
        )}
      </div>
      )}

      {/* PRIORIDADE */}
      <div className="relative" style={{ flexShrink: 0 }}>
        <Chip
          id="prio"
          icon={<span style={{ width: 9, height: 9, borderRadius: 999, backgroundColor: pColors.dot, flexShrink: 0 }} />}
          label={NOTE_PRIORITY_LABELS[priority]}
          active
          disabled={readOnly}
        />
        {pop === 'prio' && (
          <div style={popStyle}>
            {PRIORITY_ORDER.map((p) => {
              const c = NOTE_PRIORITY_COLORS[p]
              const cur = p === priority
              return (
                <button
                  key={p}
                  onClick={() => { setPop(null); void updateNote(activeNote.id, { priority: p }) }}
                  className="flex w-full items-center rounded-md text-left"
                  style={{ gap: 9, padding: '7px 9px', backgroundColor: cur ? 'rgba(16,185,129,0.10)' : 'transparent' }}
                  onMouseEnter={(e) => { if (!cur) e.currentTarget.style.backgroundColor = '#2a2a2a' }}
                  onMouseLeave={(e) => { if (!cur) e.currentTarget.style.backgroundColor = 'transparent' }}
                >
                  <span style={{ width: 9, height: 9, borderRadius: 999, backgroundColor: c.dot, flexShrink: 0 }} />
                  <span className="flex-1" style={{ fontSize: 13, color: '#e4e4e7' }}>{NOTE_PRIORITY_LABELS[p]}</span>
                  {cur && <Check size={13} style={{ color: '#10b981' }} />}
                </button>
              )
            })}
          </div>
        )}
      </div>

      {/* PRAZO */}
      <div className="relative" style={{ flexShrink: 0 }}>
        <Chip id="prazo" icon={<Calendar size={13} />} label={dueLabel} active={!!dueDate && !overdue} danger={overdue} disabled={!canEditMeta} />
        {pop === 'prazo' && (
          <div style={popStyle}>
            <input
              type="date"
              value={dueInputValue}
              onChange={(e) => { const v = e.target.value; setDueDate(v || null); if (v) setPop(null) }}
              className="bg-transparent outline-none"
              style={{ border: '1px solid #3f3f46', borderRadius: 6, padding: '7px 9px', color: '#e4e4e7', fontSize: 13, colorScheme: 'dark' }}
            />
            {dueDate && (
              <button
                onClick={() => { setPop(null); setDueDate(null) }}
                className="mt-1.5 flex w-full items-center justify-center rounded-md"
                style={{ gap: 6, padding: '6px', fontSize: 12, color: '#9a9aa3' }}
                onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = '#2a2a2a' }}
                onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent' }}
              >
                <X size={12} /> Remover prazo
              </button>
            )}
          </div>
        )}
      </div>

      {/* EMPRESA */}
      <div className="relative" style={{ flexShrink: 0 }}>
        <Chip id="empresa" icon={<Building2 size={13} />} label={company ?? 'Empresa'} active={!!company} disabled={!canEditMeta} />
        {pop === 'empresa' && (
          <div style={{ ...popStyle, width: 260 }}>
            <div className="flex items-center rounded-md" style={{ gap: 6, padding: '6px 8px', border: '1px solid #3f3f46', marginBottom: 6 }}>
              <Search size={13} style={{ color: '#71717a' }} />
              <input
                autoFocus
                value={clientSearch}
                onChange={(e) => setClientSearch(e.target.value)}
                placeholder="Buscar empresa..."
                className="flex-1 bg-transparent outline-none"
                style={{ fontSize: 13, color: '#e4e4e7' }}
              />
            </div>
            <div style={{ maxHeight: 240, overflowY: 'auto' }}>
              <button
                onClick={() => { setPop(null); setClientId(null) }}
                className="flex w-full items-center rounded-md text-left"
                style={{ padding: '7px 9px', fontSize: 13, color: '#9a9aa3' }}
                onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = '#2a2a2a' }}
                onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent' }}
              >
                Nenhuma empresa
              </button>
              {clients
                .filter((c) => !clientSearch || (c.company ?? '').toLowerCase().includes(clientSearch.toLowerCase()))
                .slice(0, 50)
                .map((c) => {
                  const cur = c.id === clientId
                  return (
                    <button
                      key={c.id}
                      onClick={() => { setPop(null); setClientId(c.id) }}
                      className="flex w-full items-center rounded-md text-left"
                      style={{ gap: 8, padding: '7px 9px', backgroundColor: cur ? 'rgba(16,185,129,0.10)' : 'transparent' }}
                      onMouseEnter={(e) => { if (!cur) e.currentTarget.style.backgroundColor = '#2a2a2a' }}
                      onMouseLeave={(e) => { if (!cur) e.currentTarget.style.backgroundColor = 'transparent' }}
                    >
                      <Building2 size={13} style={{ color: '#71717a', flexShrink: 0 }} />
                      <span className="flex-1 truncate" style={{ fontSize: 13, color: '#e4e4e7' }}>{c.company ?? '—'}</span>
                      {cur && <Check size={13} style={{ color: '#10b981' }} />}
                    </button>
                  )
                })}
              {clients.length === 0 && (
                <div style={{ padding: '8px 9px', fontSize: 12, color: '#6d6d75' }}>Nenhuma empresa cadastrada</div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* RECORRÊNCIA — conceito de tarefa/board; oculto na subnota */}
      {!isSubnote && (
      <div className="relative" style={{ flexShrink: 0 }}>
        <Chip id="recorr" icon={<Repeat size={13} />} label={recurrenceSummary(rec)} active={!!rec} disabled={!canEdit} />
        {pop === 'recorr' && (
          <div style={{ ...popStyle, width: 240 }}>
            <button
              onClick={() => { setPop(null); void updateTaskFields(task!.id, { recurrence: null, parent_template_id: null }) }}
              className="flex w-full items-center rounded-md text-left"
              style={{ padding: '7px 9px', fontSize: 13, color: !rec ? '#d1fae5' : '#9a9aa3', backgroundColor: !rec ? 'rgba(16,185,129,0.10)' : 'transparent', marginBottom: 4 }}
              onMouseEnter={(e) => { if (rec) e.currentTarget.style.backgroundColor = '#2a2a2a' }}
              onMouseLeave={(e) => { if (rec) e.currentTarget.style.backgroundColor = 'transparent' }}
            >
              Não repete
            </button>
            <div className="flex" style={{ gap: 4, marginBottom: 8 }}>
              {RECURRENCE_TYPES.map((tp) => {
                const cur = rec?.type === tp
                return (
                  <button
                    key={tp}
                    onClick={() => {
                      const base = task!.due_date ? new Date(task!.due_date) : new Date()
                      void updateTaskFields(task!.id, { recurrence: defaultRecurrence(tp, base) })
                    }}
                    className="flex-1 rounded-md"
                    style={{
                      padding: '6px 4px', fontSize: 11, fontWeight: 500,
                      color: cur ? '#fff' : '#9a9aa3',
                      backgroundColor: cur ? '#10b981' : '#2a2a2a',
                      transition: 'background-color 120ms',
                    }}
                  >
                    {RECURRENCE_LABELS[tp]}
                  </button>
                )
              })}
            </div>
            {rec && <RecurrenceParams rec={rec} onChange={(r) => updateTaskFields(task!.id, { recurrence: r })} />}
          </div>
        )}
      </div>
      )}

      {done && (
        <span style={{ marginLeft: 'auto', fontSize: 11, color: '#34d399', fontWeight: 600, flexShrink: 0 }}>✓ Concluída</span>
      )}
    </div>
  )
}

// ── Sub-controles de recorrência (dia da semana / dia do mês / mês+dia) ───────
function RecurrenceParams({ rec, onChange }: { rec: Recurrence; onChange: (r: Recurrence) => void }) {
  if (rec.type === 'weekly' || rec.type === 'biweekly') {
    return (
      <div className="flex" style={{ gap: 3 }}>
        {WEEKDAY_LABELS.map((w, i) => {
          const cur = rec.weekday === i
          return (
            <button
              key={i}
              onClick={() => onChange({ ...rec, weekday: i })}
              className="flex-1 rounded"
              style={{ padding: '6px 2px', fontSize: 10.5, color: cur ? '#fff' : '#9a9aa3', backgroundColor: cur ? '#10b981' : '#2a2a2a' }}
            >
              {w}
            </button>
          )
        })}
      </div>
    )
  }
  if (rec.type === 'monthly') {
    return (
      <label className="flex items-center" style={{ gap: 8, fontSize: 12, color: '#9a9aa3' }}>
        Dia do mês
        <input
          type="number" min={1} max={31} value={rec.day ?? 1}
          onChange={(e) => onChange({ ...rec, day: Math.min(31, Math.max(1, Number(e.target.value) || 1)) })}
          className="bg-transparent outline-none" style={{ width: 56, border: '1px solid #3f3f46', borderRadius: 6, padding: '5px 8px', color: '#e4e4e7', fontSize: 13 }}
        />
      </label>
    )
  }
  // yearly
  return (
    <div className="flex items-center" style={{ gap: 6, fontSize: 12, color: '#9a9aa3', flexWrap: 'wrap' }}>
      <select
        value={rec.month ?? 1}
        onChange={(e) => onChange({ ...rec, month: Number(e.target.value) })}
        className="bg-transparent outline-none" style={{ border: '1px solid #3f3f46', borderRadius: 6, padding: '5px 8px', color: '#e4e4e7', fontSize: 13, colorScheme: 'dark' }}
      >
        {MONTH_LABELS.map((m, i) => <option key={i} value={i + 1} style={{ backgroundColor: '#202020' }}>{m}</option>)}
      </select>
      <input
        type="number" min={1} max={31} value={rec.day ?? 1}
        onChange={(e) => onChange({ ...rec, day: Math.min(31, Math.max(1, Number(e.target.value) || 1)) })}
        className="bg-transparent outline-none" style={{ width: 56, border: '1px solid #3f3f46', borderRadius: 6, padding: '5px 8px', color: '#e4e4e7', fontSize: 13 }}
      />
    </div>
  )
}
