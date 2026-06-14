import { useState, useEffect, useRef } from 'react'

interface InputModalProps {
  visible: boolean
  title: string
  placeholder: string
  onConfirm: (value: string) => void
  onCancel: () => void
}

export default function InputModal({ visible, title, placeholder, onConfirm, onCancel }: InputModalProps) {
  const [value, setValue] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (visible) {
      setValue('')
      setTimeout(() => inputRef.current?.focus(), 0)
    }
  }, [visible])

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!visible) return
      if (e.key === 'Escape') onCancel()
      if (e.key === 'Enter' && value.trim()) onConfirm(value.trim())
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [visible, value, onConfirm, onCancel])

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
          maxWidth: '360px',
          padding: '24px',
          backgroundColor: '#18181b',
          borderRadius: '12px',
          boxShadow: '0 0 0 1px rgba(16,185,129,0.35), 0 8px 32px rgba(0,0,0,0.5)',
        }}
      >
        <p style={{ fontSize: '16px', fontWeight: 600, color: '#f4f4f5', marginBottom: '16px' }}>
          {title}
        </p>

        <input
          ref={inputRef}
          type="text"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={placeholder}
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

        <div className="flex gap-2">
          <button
            onClick={onCancel}
            className="flex-1 rounded-lg text-zinc-400 transition-colors duration-150 hover:bg-zinc-700"
            style={{ height: '36px', fontSize: '13px', backgroundColor: '#27272a' }}
          >
            Cancelar
          </button>
          <button
            onClick={() => { if (value.trim()) onConfirm(value.trim()) }}
            disabled={!value.trim()}
            className="flex-1 rounded-lg text-white transition-colors duration-150 hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-40"
            style={{ height: '36px', fontSize: '13px', backgroundColor: '#059669' }}
          >
            Confirmar
          </button>
        </div>
      </div>
    </div>
  )
}
