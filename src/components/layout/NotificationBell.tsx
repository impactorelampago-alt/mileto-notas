import { useRef, useState, useEffect } from 'react'
import { Bell, CheckCheck, CheckCircle2, FilePlus2, AtSign } from 'lucide-react'
import { useNotificationsStore } from '../../stores/notifications-store'

/** Tempo relativo curto em pt-BR (sem dependência externa). */
function timeAgo(iso: string): string {
  const s = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000))
  if (s < 60) return 'agora'
  const m = Math.floor(s / 60)
  if (m < 60) return `há ${m} min`
  const h = Math.floor(m / 60)
  if (h < 24) return `há ${h} h`
  const d = Math.floor(h / 24)
  if (d < 7) return `há ${d} d`
  const w = Math.floor(d / 7)
  if (w < 5) return `há ${w} sem`
  const mo = Math.floor(d / 30)
  if (mo < 12) return `há ${mo} ${mo > 1 ? 'meses' : 'mês'}`
  const y = Math.floor(d / 365)
  return `há ${y} ${y > 1 ? 'anos' : 'ano'}`
}

export default function NotificationBell() {
  const notifications = useNotificationsStore((s) => s.notifications)
  const actorNames = useNotificationsStore((s) => s.actorNames)
  const isOpen = useNotificationsStore((s) => s.isOpen)
  const setOpen = useNotificationsStore((s) => s.setOpen)
  const markAllRead = useNotificationsStore((s) => s.markAllRead)
  const openNotification = useNotificationsStore((s) => s.openNotification)

  const btnRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ top: number; right: number }>({ top: 44, right: 120 })

  const unread = notifications.filter((n) => !n.read_at).length

  const toggle = () => {
    if (!isOpen && btnRef.current) {
      const r = btnRef.current.getBoundingClientRect()
      setPos({ top: r.bottom + 8, right: Math.max(8, window.innerWidth - r.right) })
    }
    setOpen(!isOpen)
  }

  useEffect(() => {
    if (!isOpen) return
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node
      if (panelRef.current?.contains(t) || btnRef.current?.contains(t)) return
      setOpen(false)
    }
    window.addEventListener('mousedown', onDown)
    return () => window.removeEventListener('mousedown', onDown)
  }, [isOpen, setOpen])

  return (
    <>
      <button
        ref={btnRef}
        onClick={toggle}
        className="titlebar-no-drag relative flex h-7 w-9 items-center justify-center rounded-md"
        style={{ color: unread > 0 ? '#d4d4d8' : '#969696', transition: 'background-color 140ms, color 140ms' }}
        onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = '#232323'; e.currentTarget.style.color = '#e4e4e4' }}
        onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; e.currentTarget.style.color = unread > 0 ? '#d4d4d8' : '#969696' }}
        title="Notificações de tarefas concluídas"
      >
        <Bell size={15} />
        {unread > 0 && (
          <span
            className="absolute flex items-center justify-center"
            style={{
              top: 1, right: 2, minWidth: 15, height: 15, padding: '0 4px',
              borderRadius: 999, backgroundColor: '#ef4444', color: '#fff',
              fontSize: 9, fontWeight: 700, lineHeight: 1,
              border: '1.5px solid #1a1a1a',
            }}
          >
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>

      {isOpen && (
        <div
          ref={panelRef}
          className="fixed z-[60] overflow-hidden rounded-xl border"
          style={{
            top: pos.top, right: pos.right, width: 332, maxHeight: 420,
            backgroundColor: '#1e1e1e', borderColor: '#333333',
            boxShadow: '0 14px 40px rgba(0,0,0,0.5)',
            display: 'flex', flexDirection: 'column',
          }}
        >
          {/* Header */}
          <div
            className="flex shrink-0 items-center justify-between"
            style={{ padding: '10px 14px', borderBottom: '1px solid #2c2c2c' }}
          >
            <span style={{ color: '#e7e7ea', fontSize: 13, fontWeight: 600 }}>Notificações</span>
            {unread > 0 && (
              <button
                onClick={() => void markAllRead()}
                className="flex items-center gap-1.5 rounded-md"
                style={{ padding: '3px 8px', color: '#8a8a92', fontSize: 11.5, transition: 'background-color 120ms, color 120ms' }}
                onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = '#2a2a2a'; e.currentTarget.style.color = '#d4d4d8' }}
                onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; e.currentTarget.style.color = '#8a8a92' }}
                title="Marcar todas como lidas"
              >
                <CheckCheck size={13} /> Marcar lidas
              </button>
            )}
          </div>

          {/* Lista */}
          <div className="overflow-y-auto" style={{ flex: 1 }}>
            {notifications.length === 0 ? (
              <div
                className="flex flex-col items-center justify-center text-center"
                style={{ padding: '34px 18px', gap: 8 }}
              >
                <Bell size={28} style={{ color: '#3a3a3a' }} />
                <span style={{ color: '#6b6b72', fontSize: 12.5 }}>Nenhuma notificação ainda</span>
                <span style={{ color: '#4d4d52', fontSize: 11 }}>
                  Avisos de tarefas concluídas e novas notas em categorias compartilhadas aparecem aqui.
                </span>
              </div>
            ) : (
              notifications.map((n) => {
                const actor = (n.actor_id && actorNames[n.actor_id]) || 'Alguém'
                const isUnread = !n.read_at
                const isNoteCreated = n.type === 'note_created'
                const isMention = n.type === 'mention'
                const verb = isMention ? 'mencionou você em:' : isNoteCreated ? 'adicionou uma nota:' : 'concluiu:'
                return (
                  <button
                    key={n.id}
                    onClick={() => openNotification(n)}
                    className="flex w-full items-start gap-2.5 text-left"
                    style={{
                      padding: '11px 14px',
                      borderBottom: '1px solid #262626',
                      backgroundColor: isUnread ? 'rgba(16,185,129,0.06)' : 'transparent',
                      transition: 'background-color 120ms',
                    }}
                    onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = '#262626' }}
                    onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = isUnread ? 'rgba(16,185,129,0.06)' : 'transparent' }}
                  >
                    {isMention ? (
                      <AtSign size={15} style={{ color: '#93c5fd', flexShrink: 0, marginTop: 1 }} />
                    ) : isNoteCreated ? (
                      <FilePlus2 size={15} style={{ color: '#60a5fa', flexShrink: 0, marginTop: 1 }} />
                    ) : (
                      <CheckCircle2 size={15} style={{ color: '#34d399', flexShrink: 0, marginTop: 1 }} />
                    )}
                    <span className="min-w-0 flex-1">
                      <span style={{ display: 'block', color: '#d4d4d8', fontSize: 12.5, lineHeight: 1.35 }}>
                        <b style={{ color: '#f4f4f5', fontWeight: 600 }}>{actor}</b> {verb}
                      </span>
                      <span
                        className="truncate"
                        style={{ display: 'block', color: '#a1a1aa', fontSize: 12, marginTop: 1 }}
                        title={n.title || 'Sem título'}
                      >
                        {n.title || 'Sem título'}
                      </span>
                      <span style={{ display: 'block', color: '#6b6b72', fontSize: 10.5, marginTop: 3 }}>
                        {timeAgo(n.created_at)}
                      </span>
                    </span>
                    {isUnread && (
                      <span style={{ width: 7, height: 7, borderRadius: 999, backgroundColor: '#10b981', flexShrink: 0, marginTop: 5 }} />
                    )}
                  </button>
                )
              })
            )}
          </div>
        </div>
      )}
    </>
  )
}
