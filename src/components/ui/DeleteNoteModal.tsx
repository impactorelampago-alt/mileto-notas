import { useEffect } from 'react'
import { AlertTriangle, X } from 'lucide-react'

interface DeleteNoteModalProps {
  onConfirm: () => void
  onClose: () => void
}

export default function DeleteNoteModal({ onConfirm, onClose }: DeleteNoteModalProps) {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ backgroundColor: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)' }}
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div
        style={{
          width: '100%',
          maxWidth: '400px',
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
            Excluir nota
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

        {/* Body */}
        <div style={{ padding: '24px 20px', textAlign: 'center' }}>
          <AlertTriangle size={20} style={{ color: '#facc15', margin: '0 auto 12px' }} />
          <p style={{ fontSize: '14px', color: '#cccccc', marginBottom: '8px' }}>
            Tem certeza que deseja excluir esta nota?
          </p>
          <p style={{ fontSize: '12px', color: '#6d6d6d' }}>
            Esta ação não pode ser desfeita.
          </p>
        </div>

        {/* Footer */}
        <div
          className="flex justify-end gap-2"
          style={{ padding: '12px 20px', borderTop: '1px solid #3d3d3d' }}
        >
          <button
            onClick={onClose}
            className="rounded-lg transition-colors duration-150"
            style={{ height: '32px', padding: '0 16px', fontSize: '13px', backgroundColor: '#333333', color: '#cccccc' }}
            onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = '#3d3d3d' }}
            onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = '#333333' }}
          >
            Cancelar
          </button>
          <button
            onClick={onConfirm}
            className="rounded-lg text-white transition-colors duration-150"
            style={{ height: '32px', padding: '0 16px', fontSize: '13px', backgroundColor: '#dc2626' }}
            onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = '#b91c1c' }}
            onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = '#dc2626' }}
          >
            Excluir
          </button>
        </div>
      </div>
    </div>
  )
}
