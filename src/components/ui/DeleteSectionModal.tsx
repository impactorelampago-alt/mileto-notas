import { useEffect, useState } from 'react'
import { AlertTriangle, X } from 'lucide-react'
import { useOpsStore } from '../../stores/ops-store'
import { useNotesStore } from '../../stores/notes-store'

interface DeleteSectionModalProps {
  keySuffix: string
  onClose: () => void
}

export default function DeleteSectionModal({ keySuffix, onClose }: DeleteSectionModalProps) {
  const sections = useOpsStore((s) => s.sections)
  const tasks = useOpsStore((s) => s.tasks)
  const deleteSection = useOpsStore((s) => s.deleteSection)
  const notes = useNotesStore((s) => s.notes)
  const [isDeleting, setIsDeleting] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  const section = sections.find((s) => s.key_suffix === keySuffix)
  const tasksInSection = tasks.filter((t) => t.status.endsWith(keySuffix))
  const taskIdsInSection = new Set(tasksInSection.map((t) => t.id))
  const notesInSection = notes.filter((n) => n.task_id !== null && taskIdsInSection.has(n.task_id))

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !isDeleting) onClose()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onClose, isDeleting])

  const handleConfirm = async () => {
    if (isDeleting) return
    setIsDeleting(true)
    setErrorMessage(null)
    const result = await deleteSection(keySuffix)
    if (!result.success) {
      setErrorMessage(result.error ?? 'Erro desconhecido')
      setIsDeleting(false)
      return
    }
    onClose()
  }

  if (!section) {
    return null
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ backgroundColor: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)' }}
      onMouseDown={(e) => { if (e.target === e.currentTarget && !isDeleting) onClose() }}
    >
      <div
        style={{
          width: '100%',
          maxWidth: '440px',
          backgroundColor: '#1e1e1e',
          borderRadius: '12px',
          border: '1px solid #3d3d3d',
          boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
        }}
      >
        <div
          className="flex items-center justify-between"
          style={{ padding: '16px 20px', borderBottom: '1px solid #3d3d3d' }}
        >
          <div className="flex items-center gap-2">
            <span style={{ width: 10, height: 10, borderRadius: '50%', backgroundColor: section.color }} />
            <span style={{ fontSize: '16px', fontWeight: 600, color: '#cccccc' }}>
              Excluir seção "{section.label}"
            </span>
          </div>
          <button
            onClick={onClose}
            disabled={isDeleting}
            className="flex h-7 w-7 items-center justify-center rounded transition-colors duration-150"
            style={{ color: '#6d6d6d', opacity: isDeleting ? 0.4 : 1 }}
            onMouseEnter={(e) => { if (!isDeleting) { e.currentTarget.style.backgroundColor = '#333333'; e.currentTarget.style.color = '#cccccc' } }}
            onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; e.currentTarget.style.color = '#6d6d6d' }}
          >
            <X size={16} />
          </button>
        </div>

        <div style={{ padding: '24px 20px', textAlign: 'center' }}>
          <AlertTriangle size={24} style={{ color: '#facc15', margin: '0 auto 12px' }} />
          <p style={{ fontSize: '14px', color: '#cccccc', marginBottom: '8px' }}>
            Tem certeza que deseja excluir esta seção?
          </p>
          <p style={{ fontSize: '12px', color: '#a1a1aa', marginBottom: '4px' }}>
            {tasksInSection.length === 0
              ? 'Esta seção não contém tarefas.'
              : `Todas as ${tasksInSection.length} tarefa${tasksInSection.length === 1 ? '' : 's'} e ${notesInSection.length} nota${notesInSection.length === 1 ? '' : 's'} dentro dela serão excluídas permanentemente.`}
          </p>
          <p style={{ fontSize: '12px', color: '#6d6d6d' }}>
            Esta ação não pode ser desfeita.
          </p>
          {errorMessage && (
            <p style={{ marginTop: '16px', fontSize: '12px', color: '#f87171', backgroundColor: '#451a1a', padding: '8px 12px', borderRadius: '8px', border: '1px solid #7f1d1d' }}>
              {errorMessage}
            </p>
          )}
        </div>

        <div
          className="flex justify-end gap-2"
          style={{ padding: '12px 20px', borderTop: '1px solid #3d3d3d' }}
        >
          <button
            onClick={onClose}
            disabled={isDeleting}
            className="rounded-lg transition-colors duration-150"
            style={{ height: '32px', padding: '0 16px', fontSize: '13px', backgroundColor: '#333333', color: '#cccccc', opacity: isDeleting ? 0.5 : 1 }}
            onMouseEnter={(e) => { if (!isDeleting) e.currentTarget.style.backgroundColor = '#3d3d3d' }}
            onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = '#333333' }}
          >
            Cancelar
          </button>
          <button
            onClick={() => void handleConfirm()}
            disabled={isDeleting}
            className="rounded-lg text-white transition-colors duration-150"
            style={{ height: '32px', padding: '0 16px', fontSize: '13px', backgroundColor: '#dc2626', opacity: isDeleting ? 0.5 : 1 }}
            onMouseEnter={(e) => { if (!isDeleting) e.currentTarget.style.backgroundColor = '#b91c1c' }}
            onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = '#dc2626' }}
          >
            {isDeleting ? 'Excluindo...' : 'Excluir seção'}
          </button>
        </div>
      </div>
    </div>
  )
}
