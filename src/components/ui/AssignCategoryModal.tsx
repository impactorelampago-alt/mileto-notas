import { useEffect } from 'react'
import { useCategoriesStore } from '../../stores/categories-store'

interface AssignCategoryModalProps {
  visible: boolean
  onSelect: (categoryId: string | null) => void
  onCancel: () => void
}

export default function AssignCategoryModal({ visible, onSelect, onCancel }: AssignCategoryModalProps) {
  const categories = useCategoriesStore((s) => s.categories)

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!visible) return
      if (e.key === 'Escape') onCancel()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [visible, onCancel])

  if (!visible) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ backgroundColor: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)' }}
      onMouseDown={(e) => { if (e.target === e.currentTarget) onCancel() }}
    >
      <div
        style={{
          width: '100%',
          maxWidth: '320px',
          padding: '20px',
          backgroundColor: '#18181b',
          borderRadius: '12px',
          boxShadow: '0 0 0 1px rgba(16,185,129,0.35), 0 8px 32px rgba(0,0,0,0.5)',
        }}
      >
        <p style={{ fontSize: '16px', fontWeight: 600, color: '#f4f4f5', marginBottom: '12px' }}>
          Atribuir categoria
        </p>

        <div className="flex flex-col gap-0.5">
          {/* Opção sem categoria */}
          <button
            onClick={() => onSelect(null)}
            className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left transition-colors duration-150 hover:bg-zinc-800"
          >
            <span
              className="h-3 w-3 shrink-0 rounded-full"
              style={{ backgroundColor: '#3f3f46' }}
            />
            <span style={{ fontSize: '13px', color: '#a1a1aa' }}>Sem categoria</span>
          </button>

          {categories.map((cat) => (
            <button
              key={cat.id}
              onClick={() => onSelect(cat.id)}
              className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left transition-colors duration-150 hover:bg-zinc-800"
            >
              <span
                className="h-3 w-3 shrink-0 rounded-full"
                style={{ backgroundColor: cat.color }}
              />
              <span style={{ fontSize: '13px', color: '#e4e4e7' }}>{cat.name}</span>
            </button>
          ))}

          {categories.length === 0 && (
            <p className="px-3 py-2 text-[12px] text-zinc-600">
              Nenhuma categoria criada ainda
            </p>
          )}
        </div>

        <div style={{ marginTop: '12px' }}>
          <button
            onClick={onCancel}
            className="w-full rounded-lg text-zinc-400 transition-colors duration-150 hover:bg-zinc-700"
            style={{ height: '36px', fontSize: '13px', backgroundColor: '#27272a' }}
          >
            Cancelar
          </button>
        </div>
      </div>
    </div>
  )
}
