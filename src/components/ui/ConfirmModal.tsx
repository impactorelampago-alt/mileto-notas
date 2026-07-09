import { useEffect } from 'react'
import { AlertTriangle, X } from 'lucide-react'
import { useUIStore } from '../../stores/ui-store'

/** Diálogo de confirmação genérico (excluir/concluir/etc). Renderizado uma vez no
 * MainApp; qualquer ação chama `useUIStore.getState().openConfirm({...})`. */
export default function ConfirmModal() {
  const confirm = useUIStore((s) => s.confirm)
  const close = useUIStore((s) => s.closeConfirm)

  useEffect(() => {
    if (!confirm) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close()
      if (e.key === 'Enter') { confirm.onConfirm(); close() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [confirm, close])

  if (!confirm) return null
  const danger = confirm.danger ?? false
  const accent = danger ? '#dc2626' : '#10b981'
  const accentHover = danger ? '#b91c1c' : '#059669'

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center"
      style={{ backgroundColor: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)' }}
      onMouseDown={(e) => { if (e.target === e.currentTarget) close() }}
    >
      <div style={{ width: '100%', maxWidth: 400, backgroundColor: '#1e1e1e', borderRadius: 12, border: '1px solid #3d3d3d', boxShadow: '0 8px 32px rgba(0,0,0,0.5)' }}>
        <div className="flex items-center justify-between" style={{ padding: '16px 20px', borderBottom: '1px solid #3d3d3d' }}>
          <span style={{ fontSize: 16, fontWeight: 600, color: '#cccccc' }}>{confirm.title}</span>
          <button
            onClick={close}
            className="flex h-7 w-7 items-center justify-center rounded transition-colors"
            style={{ color: '#6d6d6d' }}
            onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = '#333'; e.currentTarget.style.color = '#ccc' }}
            onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; e.currentTarget.style.color = '#6d6d6d' }}
          >
            <X size={16} />
          </button>
        </div>

        <div style={{ padding: '24px 20px', textAlign: 'center' }}>
          <AlertTriangle size={20} style={{ color: danger ? '#f87171' : '#facc15', margin: '0 auto 12px' }} />
          <p style={{ fontSize: 14, color: '#cccccc', whiteSpace: 'pre-line' }}>{confirm.message ?? 'Tem certeza?'}</p>
        </div>

        <div className="flex justify-end gap-2" style={{ padding: '12px 20px', borderTop: '1px solid #3d3d3d' }}>
          <button
            onClick={close}
            className="rounded-lg transition-colors"
            style={{ height: 32, padding: '0 16px', fontSize: 13, backgroundColor: '#333', color: '#ccc' }}
            onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = '#3d3d3d' }}
            onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = '#333' }}
          >
            Cancelar
          </button>
          <button
            onClick={() => { confirm.onConfirm(); close() }}
            className="rounded-lg text-white transition-colors"
            style={{ height: 32, padding: '0 16px', fontSize: 13, backgroundColor: accent }}
            onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = accentHover }}
            onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = accent }}
          >
            {confirm.confirmLabel ?? 'Confirmar'}
          </button>
        </div>
      </div>
    </div>
  )
}
