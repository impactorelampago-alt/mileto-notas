import { useState, useEffect, useRef } from 'react'

interface CategoryModalProps {
  visible: boolean
  onConfirm: (name: string, color: string) => void
  onCancel: () => void
  initialName?: string
  initialColor?: string
  mode?: 'create' | 'edit'
}

const PRESET_COLORS = [
  '#3b82f6',
  '#10b981',
  '#ef4444',
  '#f59e0b',
  '#8b5cf6',
  '#ec4899',
  '#f97316',
  '#06b6d4',
]

export default function CategoryModal({
  visible,
  onConfirm,
  onCancel,
  initialName = '',
  initialColor,
  mode = 'create',
}: CategoryModalProps) {
  const [name, setName] = useState('')
  const [selectedColor, setSelectedColor] = useState(PRESET_COLORS[0])
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (visible) {
      setName(initialName)
      setSelectedColor(initialColor ?? PRESET_COLORS[0])
      setTimeout(() => inputRef.current?.focus(), 0)
    }
  }, [visible, initialName, initialColor])

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!visible) return
      if (e.key === 'Escape') onCancel()
      if (e.key === 'Enter' && name.trim()) onConfirm(name.trim(), selectedColor)
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [visible, name, selectedColor, onConfirm, onCancel])

  if (!visible) return null

  const isEdit = mode === 'edit'

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ backgroundColor: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)' }}
      onMouseDown={(e) => { if (e.target === e.currentTarget) onCancel() }}
    >
      <div
        style={{
          width: '100%',
          maxWidth: '360px',
          padding: '24px',
          backgroundColor: '#18181b',
          borderRadius: '12px',
          boxShadow: '0 0 0 1px rgba(16,185,129,0.35), 0 8px 32px rgba(0,0,0,0.5)',
        }}
      >
        <p style={{ fontSize: '16px', fontWeight: 600, color: '#f4f4f5', marginBottom: '16px' }}>
          {isEdit ? 'Editar categoria' : 'Nova categoria'}
        </p>

        <input
          ref={inputRef}
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Nome da categoria"
          className="w-full text-zinc-200 placeholder:text-zinc-600 outline-none"
          style={{
            backgroundColor: '#27272a',
            border: '1px solid #3f3f46',
            borderRadius: '8px',
            height: '36px',
            fontSize: '13px',
            padding: '0 12px',
            marginBottom: '16px',
          }}
        />

        {/* Seletor de cor */}
        <div style={{ marginBottom: '20px' }}>
          <p style={{ fontSize: '11px', color: '#71717a', marginBottom: '8px', letterSpacing: '0.5px' }}>
            COR
          </p>
          <div className="flex gap-2">
            {PRESET_COLORS.map((color) => (
              <button
                key={color}
                onClick={() => setSelectedColor(color)}
                className="h-6 w-6 rounded-full transition-transform duration-100 hover:scale-110"
                style={{
                  backgroundColor: color,
                  outline: selectedColor === color ? `2px solid #10b981` : '2px solid transparent',
                  outlineOffset: '2px',
                }}
              />
            ))}
          </div>
        </div>

        <div className="flex gap-2">
          <button
            onClick={onCancel}
            className="flex-1 rounded-lg text-zinc-400 transition-colors duration-150 hover:bg-zinc-700"
            style={{ height: '36px', fontSize: '13px', backgroundColor: '#27272a' }}
          >
            Cancelar
          </button>
          <button
            onClick={() => { if (name.trim()) onConfirm(name.trim(), selectedColor) }}
            disabled={!name.trim()}
            className="flex-1 rounded-lg text-white transition-colors duration-150 hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-40"
            style={{ height: '36px', fontSize: '13px', backgroundColor: '#059669' }}
          >
            {isEdit ? 'Salvar' : 'Criar'}
          </button>
        </div>
      </div>
    </div>
  )
}
