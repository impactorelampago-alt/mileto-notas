import { ArrowLeft, Code2, History, RefreshCw, RotateCcw, UserCheck, Users } from 'lucide-react'
import { useEffect, type ReactNode } from 'react'
import {
  useProgramHistoryStore,
  type ProgramHistoryPeriod,
} from '../stores/program-history-store'
import { NOTE_PRIORITY_COLORS, NOTE_PRIORITY_LABELS, normalizePriority } from '../lib/note-priority'

const PERIOD_LABELS: Record<ProgramHistoryPeriod, string> = {
  '30d': 'Últimos 30 dias',
  '90d': 'Últimos 90 dias',
  all: 'Todo o histórico',
}

const dateFormatter = new Intl.DateTimeFormat('pt-BR', {
  day: '2-digit',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
})

export default function ProgramHistory() {
  const programs = useProgramHistoryStore((state) => state.programs)
  const accessLevel = useProgramHistoryStore((state) => state.accessLevel)
  const selectedProgramId = useProgramHistoryStore((state) => state.selectedProgramId)
  const period = useProgramHistoryStore((state) => state.period)
  const items = useProgramHistoryStore((state) => state.items)
  const metrics = useProgramHistoryStore((state) => state.metrics)
  const isLoading = useProgramHistoryStore((state) => state.isLoadingHistory)
  const error = useProgramHistoryStore((state) => state.error)
  const closeHistory = useProgramHistoryStore((state) => state.closeHistory)
  const selectProgram = useProgramHistoryStore((state) => state.selectProgram)
  const setPeriod = useProgramHistoryStore((state) => state.setPeriod)
  const loadHistory = useProgramHistoryStore((state) => state.loadHistory)
  const reopenItem = useProgramHistoryStore((state) => state.reopenItem)

  const selectedProgram = programs.find((program) => program.id === selectedProgramId) ?? null
  const reporters = metrics.filter((metric) => metric.reported_count > 0)
  const developers = metrics.filter((metric) => metric.completed_count > 0)

  // Realtime direto não é exposto para a tabela de auditoria (leitura somente
  // via RPC). Reconcilia ao voltar para a janela e a cada minuto enquanto visível.
  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState === 'visible') void loadHistory()
    }
    const interval = window.setInterval(refresh, 60_000)
    window.addEventListener('focus', refresh)
    return () => {
      window.clearInterval(interval)
      window.removeEventListener('focus', refresh)
    }
  }, [loadHistory, selectedProgramId, period])

  return (
    <main className="flex min-h-0 flex-1 flex-col" style={{ backgroundColor: '#181818' }}>
      <header
        className="flex shrink-0 items-center justify-between"
        style={{ height: 54, padding: '0 22px', borderBottom: '1px solid #2d2d2d', backgroundColor: '#1d1d1d' }}
      >
        <div className="flex items-center gap-3">
          <button
            onClick={closeHistory}
            className="flex h-8 w-8 items-center justify-center rounded-md transition-colors hover:bg-zinc-800"
            style={{ color: '#a1a1aa' }}
            title="Voltar para as notas"
          >
            <ArrowLeft size={16} />
          </button>
          <div className="flex items-center gap-2">
            <History size={17} style={{ color: '#34d399' }} />
            <div>
              <h1 style={{ color: '#f4f4f5', fontSize: 15, fontWeight: 600, lineHeight: 1.2 }}>
                Histórico de programas
              </h1>
              <p style={{ color: '#71717a', fontSize: 10.5, marginTop: 2 }}>
                Subnotas concluídas e indicadores de atividade
              </p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => { void loadHistory() }}
            disabled={isLoading}
            className="flex h-8 w-8 items-center justify-center rounded-md transition-colors hover:bg-zinc-800 disabled:opacity-50"
            style={{ color: '#a1a1aa' }}
            title="Atualizar histórico"
          >
            <RefreshCw size={14} className={isLoading ? 'animate-spin' : undefined} />
          </button>
          <select
            value={period}
            onChange={(event) => { void setPeriod(event.target.value as ProgramHistoryPeriod) }}
            className="rounded-md outline-none"
            style={{
              height: 32,
              padding: '0 10px',
              backgroundColor: '#27272a',
              border: '1px solid #3f3f46',
              color: '#d4d4d8',
              fontSize: 12,
            }}
          >
            {(Object.keys(PERIOD_LABELS) as ProgramHistoryPeriod[]).map((value) => (
              <option key={value} value={value}>{PERIOD_LABELS[value]}</option>
            ))}
          </select>
        </div>
      </header>

      <div
        className="flex shrink-0 items-center gap-1 overflow-x-auto"
        style={{ minHeight: 43, padding: '6px 18px', borderBottom: '1px solid #292929', backgroundColor: '#1b1b1b' }}
      >
        {programs.map((program) => {
          const active = program.id === selectedProgramId
          return (
            <button
              key={program.id}
              onClick={() => { void selectProgram(program.id) }}
              className="flex shrink-0 items-center gap-2 rounded-md transition-colors"
              style={{
                height: 30,
                padding: '0 11px',
                backgroundColor: active ? 'rgba(16,185,129,0.14)' : 'transparent',
                border: `1px solid ${active ? 'rgba(52,211,153,0.35)' : 'transparent'}`,
                color: active ? '#d1fae5' : '#a1a1aa',
                fontSize: 12,
              }}
            >
              <Code2 size={13} style={{ color: program.color }} />
              {program.name}
              {!program.active && (
                <span style={{ color: '#71717a', fontSize: 9.5 }}>inativo</span>
              )}
            </button>
          )
        })}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto" style={{ padding: 20 }}>
        {programs.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center text-center">
            <Code2 size={30} style={{ color: '#52525b', marginBottom: 10 }} />
            <p style={{ color: '#d4d4d8', fontSize: 13 }}>Nenhuma categoria foi marcada como programa.</p>
            <p style={{ color: '#71717a', fontSize: 11.5, marginTop: 5 }}>
              Use o seletor de categorias para criar ou classificar um programa.
            </p>
          </div>
        ) : (
          <div className="mx-auto flex w-full max-w-[1320px] flex-col" style={{ gap: 18 }}>
            <section className="grid grid-cols-1 gap-3 lg:grid-cols-2">
              <MetricTable
                icon={<Users size={15} />}
                title="Solicitações enviadas"
                subtitle={accessLevel === 'TEAM' ? 'Por responsável da nota principal' : 'Seus envios'}
                rows={reporters.map((metric) => ({
                  id: metric.user_id,
                  name: metric.user_name,
                  count: metric.reported_count,
                }))}
              />
              <MetricTable
                icon={<UserCheck size={15} />}
                title="Entregas concluídas"
                subtitle={accessLevel === 'TEAM' ? 'Por pessoa que concluiu' : 'Suas entregas'}
                rows={developers.map((metric) => ({
                  id: metric.user_id,
                  name: metric.user_name,
                  count: metric.completed_count,
                }))}
              />
            </section>

            <section
              className="overflow-hidden rounded-xl"
              style={{ border: '1px solid #303030', backgroundColor: '#202020' }}
            >
              <div className="flex items-center justify-between" style={{ padding: '13px 16px', borderBottom: '1px solid #303030' }}>
                <div>
                  <h2 style={{ color: '#e4e4e7', fontSize: 13, fontWeight: 600 }}>
                    Entregas — {selectedProgram?.name ?? 'Programa'}
                  </h2>
                  <p style={{ color: '#71717a', fontSize: 10.5, marginTop: 2 }}>
                    {items.length} subnota{items.length === 1 ? '' : 's'} no período
                  </p>
                </div>
              </div>

              {error && (
                <div role="alert" style={{ margin: 12, padding: '9px 11px', borderRadius: 7, color: '#fca5a5', backgroundColor: 'rgba(127,29,29,0.24)', border: '1px solid rgba(248,113,113,0.3)', fontSize: 11.5 }}>
                  {error}
                </div>
              )}

              {isLoading ? (
                <div style={{ padding: 32, color: '#71717a', fontSize: 12, textAlign: 'center' }}>
                  Carregando histórico…
                </div>
              ) : items.length === 0 ? (
                <div style={{ padding: 32, color: '#71717a', fontSize: 12, textAlign: 'center' }}>
                  Nenhuma subnota concluída neste período.
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full border-collapse" style={{ minWidth: 900 }}>
                    <thead>
                      <tr style={{ color: '#71717a', fontSize: 10.5, textAlign: 'left' }}>
                        <th style={{ padding: '9px 14px', fontWeight: 600 }}>SUBNOTA</th>
                        <th style={{ padding: '9px 12px', fontWeight: 600 }}>ENVIADA POR</th>
                        <th style={{ padding: '9px 12px', fontWeight: 600 }}>CONCLUÍDA POR</th>
                        <th style={{ padding: '9px 12px', fontWeight: 600 }}>PRIORIDADE</th>
                        <th style={{ padding: '9px 12px', fontWeight: 600 }}>CONCLUSÃO</th>
                        <th style={{ width: 52, padding: '9px 12px' }} />
                      </tr>
                    </thead>
                    <tbody>
                      {items.map((item) => {
                        const priority = normalizePriority(item.priority)
                        const priorityColors = NOTE_PRIORITY_COLORS[priority]
                        return (
                          <tr key={item.id} style={{ borderTop: '1px solid #2d2d2d', color: '#d4d4d8', fontSize: 11.5 }}>
                            <td style={{ padding: '11px 14px', maxWidth: 390 }}>
                              <div className="truncate" style={{ color: '#f4f4f5', fontWeight: 500 }}>
                                {item.title || 'Sem título'}
                              </div>
                              {item.content && item.content !== item.title && (
                                <div className="truncate" style={{ color: '#71717a', fontSize: 10.5, marginTop: 3 }}>
                                  {item.content.replace(/\s+/g, ' ').trim()}
                                </div>
                              )}
                            </td>
                            <td style={{ padding: '11px 12px' }}>
                              {item.reporter_name || item.root_title || 'Usuário'}
                            </td>
                            <td style={{ padding: '11px 12px' }}>
                              {item.completed_by_name || 'Usuário'}
                            </td>
                            <td style={{ padding: '11px 12px' }}>
                              <span className="inline-flex items-center gap-1.5">
                                <span style={{ width: 7, height: 7, borderRadius: 999, backgroundColor: priorityColors.dot }} />
                                {NOTE_PRIORITY_LABELS[priority]}
                              </span>
                            </td>
                            <td style={{ padding: '11px 12px', color: '#a1a1aa' }}>
                              {dateFormatter.format(new Date(item.completed_at))}
                            </td>
                            <td style={{ padding: '7px 12px' }}>
                              {item.can_reopen && (
                                <button
                                  onClick={() => { void reopenItem(item.id) }}
                                  className="flex h-7 w-7 items-center justify-center rounded-md transition-colors hover:bg-zinc-700"
                                  style={{ color: '#8a8a92' }}
                                  title="Reabrir subnota"
                                >
                                  <RotateCcw size={13} />
                                </button>
                              )}
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          </div>
        )}
      </div>
    </main>
  )
}

interface MetricTableProps {
  icon: ReactNode
  title: string
  subtitle: string
  rows: Array<{ id: string; name: string; count: number }>
}

function MetricTable({ icon, title, subtitle, rows }: MetricTableProps) {
  return (
    <div className="overflow-hidden rounded-xl" style={{ border: '1px solid #303030', backgroundColor: '#202020' }}>
      <div className="flex items-center gap-2" style={{ padding: '12px 14px', borderBottom: '1px solid #303030' }}>
        <span style={{ color: '#34d399' }}>{icon}</span>
        <div>
          <h2 style={{ color: '#e4e4e7', fontSize: 12.5, fontWeight: 600 }}>{title}</h2>
          <p style={{ color: '#71717a', fontSize: 10, marginTop: 1 }}>{subtitle}</p>
        </div>
      </div>
      {rows.length === 0 ? (
        <div style={{ padding: 20, color: '#71717a', fontSize: 11.5, textAlign: 'center' }}>
          Sem dados no período.
        </div>
      ) : (
        <div>
          {rows.map((row, index) => (
            <div
              key={row.id}
              className="flex items-center justify-between"
              style={{ padding: '9px 14px', borderTop: index === 0 ? 'none' : '1px solid #2b2b2b' }}
            >
              <span className="truncate" style={{ color: '#c4c4c7', fontSize: 11.5 }}>{row.name || 'Usuário'}</span>
              <span style={{ minWidth: 28, padding: '2px 8px', borderRadius: 999, color: '#6ee7b7', backgroundColor: 'rgba(16,185,129,0.12)', textAlign: 'center', fontSize: 11, fontWeight: 600 }}>
                {row.count}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
