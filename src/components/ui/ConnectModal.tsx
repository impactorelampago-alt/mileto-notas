import { useState, useEffect } from 'react'
import { X, Search, Building2, CheckSquare } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useNotesStore } from '../../stores/notes-store'
import { useUIStore } from '../../stores/ui-store'

interface ConnectModalProps {
  noteId: string
  currentClientId: string | null
  currentTaskId: string | null
  onClose: () => void
}

interface OpsClient {
  id: string
  company: string
}

interface OpsTask {
  id: string
  title: string
  status: string | null
  priority: string | null
}

function PriorityBadge({ priority }: { priority: string | null }) {
  if (!priority) return null
  const colors: Record<string, { bg: string; text: string }> = {
    URGENT: { bg: '#7f1d1d', text: '#fca5a5' },
    HIGH: { bg: '#7c2d12', text: '#fdba74' },
    MEDIUM: { bg: '#333333', text: '#969696' },
    LOW: { bg: '#252526', text: '#6d6d6d' },
  }
  const c = colors[priority] ?? colors.MEDIUM
  return (
    <span
      className="rounded text-[10px] font-medium"
      style={{ padding: '1px 6px', backgroundColor: c.bg, color: c.text }}
    >
      {priority}
    </span>
  )
}

export default function ConnectModal({ noteId, currentClientId, currentTaskId, onClose }: ConnectModalProps) {
  const connectModalTab = useUIStore((s) => s.connectModalTab)
  const setConnectModalTab = useUIStore((s) => s.setConnectModalTab)
  const updateNote = useNotesStore((s) => s.updateNote)

  const [clients, setClients] = useState<OpsClient[]>([])
  const [tasks, setTasks] = useState<OpsTask[]>([])
  const [searchQuery, setSearchQuery] = useState('')
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  useEffect(() => {
    const load = async () => {
      setIsLoading(true)
      try {
        const [clientsRes, tasksRes] = await Promise.all([
          supabase.from('clients').select('id, company').order('company', { ascending: true }),
          supabase.from('tasks').select('id, title, status, priority').order('title', { ascending: true }),
        ])
        setClients((clientsRes.data ?? []) as OpsClient[])
        setTasks((tasksRes.data ?? []) as OpsTask[])
      } finally {
        setIsLoading(false)
      }
    }
    void load()
  }, [])

  const q = searchQuery.toLowerCase()

  const filteredClients = clients.filter((c) =>
    !q || c.company.toLowerCase().includes(q),
  )

  const filteredTasks = tasks.filter((t) =>
    !q || t.title.toLowerCase().includes(q),
  )

  const handleLinkClient = (clientId: string) => {
    void updateNote(noteId, { client_id: clientId })
    onClose()
  }

  const handleLinkTask = (taskId: string) => {
    void updateNote(noteId, { task_id: taskId })
    onClose()
  }

  const handleUnlinkClient = () => {
    void updateNote(noteId, { client_id: null })
  }

  const handleUnlinkTask = () => {
    void updateNote(noteId, { task_id: null })
  }

  const currentClientName = currentClientId
    ? clients.find((c) => c.id === currentClientId)?.company ?? null
    : null

  const currentTaskName = currentTaskId
    ? tasks.find((t) => t.id === currentTaskId)?.title ?? null
    : null

  const tabStyle = (active: boolean) => ({
    padding: '6px 16px',
    fontSize: '13px',
    fontWeight: 500 as const,
    color: active ? '#10b981' : '#6d6d6d',
    borderBottom: active ? '2px solid #10b981' : '2px solid transparent',
    backgroundColor: 'transparent',
    cursor: 'pointer' as const,
  })

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ backgroundColor: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)' }}
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div
        style={{
          width: '100%',
          maxWidth: '480px',
          maxHeight: '80vh',
          display: 'flex',
          flexDirection: 'column',
          backgroundColor: '#1e1e1e',
          borderRadius: '12px',
          border: '1px solid #3d3d3d',
          boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
        }}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between"
          style={{ padding: '16px 20px', borderBottom: '1px solid #3d3d3d' }}
        >
          <span style={{ fontSize: '16px', fontWeight: 600, color: '#cccccc' }}>
            Conectar nota
          </span>
          <button
            onClick={onClose}
            className="flex h-7 w-7 items-center justify-center rounded transition-colors duration-150"
            style={{ color: '#6d6d6d' }}
            onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = '#333333'; e.currentTarget.style.color = '#cccccc' }}
            onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; e.currentTarget.style.color = '#6d6d6d' }}
          >
            <X size={16} />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex" style={{ borderBottom: '1px solid #3d3d3d', padding: '0 20px' }}>
          <button
            onClick={() => { setConnectModalTab('empresa'); setSearchQuery('') }}
            style={tabStyle(connectModalTab === 'empresa')}
          >
            Empresa
          </button>
          <button
            onClick={() => { setConnectModalTab('tarefa'); setSearchQuery('') }}
            style={tabStyle(connectModalTab === 'tarefa')}
          >
            Tarefa
          </button>
        </div>

        {/* Body */}
        <div style={{ padding: '12px 20px', overflowY: 'auto', flex: 1 }}>
          {/* Search */}
          <div
            className="flex items-center gap-2"
            style={{
              backgroundColor: '#252526',
              border: '1px solid #3d3d3d',
              borderRadius: '8px',
              padding: '0 10px',
              marginBottom: '8px',
            }}
          >
            <Search size={14} style={{ color: '#6d6d6d', flexShrink: 0 }} />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Buscar..."
              className="w-full outline-none"
              style={{ backgroundColor: 'transparent', color: '#cccccc', fontSize: '13px', height: '34px', border: 'none' }}
            />
          </div>

          {/* List */}
          <div style={{ maxHeight: '300px', overflowY: 'auto', marginBottom: '12px' }}>
            {isLoading ? (
              <p style={{ fontSize: '13px', color: '#6d6d6d', padding: '16px 0', textAlign: 'center' }}>Carregando...</p>
            ) : connectModalTab === 'empresa' ? (
              filteredClients.length === 0 ? (
                <p style={{ fontSize: '13px', color: '#6d6d6d', padding: '16px 0', textAlign: 'center' }}>Nenhum resultado encontrado</p>
              ) : (
                filteredClients.map((client) => (
                  <div
                    key={client.id}
                    className="flex items-center gap-3"
                    style={{ padding: '8px 8px', borderRadius: '8px' }}
                    onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = '#252526' }}
                    onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent' }}
                  >
                    <Building2 size={15} style={{ color: '#6d6d6d', flexShrink: 0 }} />
                    <span className="flex-1 text-[13px]" style={{ color: '#cccccc', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {client.company}
                    </span>
                    {currentClientId === client.id ? (
                      <span className="text-[11px] font-medium" style={{ color: '#10b981' }}>Vinculado</span>
                    ) : (
                      <button
                        onClick={() => handleLinkClient(client.id)}
                        className="rounded text-[11px] font-medium text-white transition-colors duration-150 hover:bg-emerald-500"
                        style={{ padding: '2px 10px', backgroundColor: '#059669' }}
                      >
                        Vincular
                      </button>
                    )}
                  </div>
                ))
              )
            ) : (
              filteredTasks.length === 0 ? (
                <p style={{ fontSize: '13px', color: '#6d6d6d', padding: '16px 0', textAlign: 'center' }}>Nenhum resultado encontrado</p>
              ) : (
                filteredTasks.map((task) => (
                  <div
                    key={task.id}
                    className="flex items-center gap-3"
                    style={{ padding: '8px 8px', borderRadius: '8px' }}
                    onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = '#252526' }}
                    onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent' }}
                  >
                    <CheckSquare size={15} style={{ color: '#6d6d6d', flexShrink: 0 }} />
                    <span className="flex-1 text-[13px]" style={{ color: '#cccccc', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {task.title}
                    </span>
                    <PriorityBadge priority={task.priority} />
                    {currentTaskId === task.id ? (
                      <span className="text-[11px] font-medium" style={{ color: '#10b981' }}>Vinculado</span>
                    ) : (
                      <button
                        onClick={() => handleLinkTask(task.id)}
                        className="rounded text-[11px] font-medium text-white transition-colors duration-150 hover:bg-emerald-500"
                        style={{ padding: '2px 10px', backgroundColor: '#059669' }}
                      >
                        Vincular
                      </button>
                    )}
                  </div>
                ))
              )
            )}
          </div>

          {/* Vinculado atual */}
          {connectModalTab === 'empresa' && currentClientName && (
            <div
              className="flex items-center gap-3"
              style={{ padding: '8px 12px', borderRadius: '8px', backgroundColor: '#252526' }}
            >
              <span className="text-[12px]" style={{ color: '#6d6d6d' }}>Vinculado:</span>
              <span className="flex-1 text-[13px]" style={{ color: '#cccccc' }}>{currentClientName}</span>
              <button
                onClick={handleUnlinkClient}
                className="rounded text-[11px] font-medium transition-colors duration-150"
                style={{ padding: '2px 10px', backgroundColor: '#333333', color: '#969696' }}
                onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = '#3d3d3d' }}
                onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = '#333333' }}
              >
                Remover
              </button>
            </div>
          )}
          {connectModalTab === 'tarefa' && currentTaskName && (
            <div
              className="flex items-center gap-3"
              style={{ padding: '8px 12px', borderRadius: '8px', backgroundColor: '#252526' }}
            >
              <span className="text-[12px]" style={{ color: '#6d6d6d' }}>Vinculado:</span>
              <span className="flex-1 text-[13px]" style={{ color: '#cccccc' }}>{currentTaskName}</span>
              <button
                onClick={handleUnlinkTask}
                className="rounded text-[11px] font-medium transition-colors duration-150"
                style={{ padding: '2px 10px', backgroundColor: '#333333', color: '#969696' }}
                onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = '#3d3d3d' }}
                onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = '#333333' }}
              >
                Remover
              </button>
            </div>
          )}
        </div>

        {/* Footer */}
        <div
          className="flex justify-end"
          style={{ padding: '12px 20px', borderTop: '1px solid #3d3d3d' }}
        >
          <button
            onClick={onClose}
            className="rounded-lg transition-colors duration-150"
            style={{ height: '32px', padding: '0 16px', fontSize: '13px', backgroundColor: '#333333', color: '#cccccc' }}
            onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = '#3d3d3d' }}
            onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = '#333333' }}
          >
            Fechar
          </button>
        </div>
      </div>
    </div>
  )
}
