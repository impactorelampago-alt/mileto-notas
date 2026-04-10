import { useState, useEffect } from 'react'
import { Minus, Maximize2, Minimize2, X, NotebookPen } from 'lucide-react'
import { useNotesStore } from '../../stores/notes-store'

export default function Titlebar() {
  const [isMaximized, setIsMaximized] = useState(false)
  const activeNote = useNotesStore((s) => s.notes.find((n) => n.id === s.activeTabId))

  useEffect(() => {
    const syncMaximized = async () => {
      const maximized = await window.electronAPI.window.isMaximized()
      setIsMaximized(maximized)
    }

    syncMaximized()
    window.addEventListener('resize', syncMaximized)
    return () => window.removeEventListener('resize', syncMaximized)
  }, [])

  const handleMaximize = () => {
    window.electronAPI.window.maximize()
    setIsMaximized((prev) => !prev)
  }

  return (
    <div
      className="titlebar-drag flex h-9 shrink-0 items-center justify-between pl-3 pr-2"
      style={{ backgroundColor: '#1e1e1e', borderBottom: '1px solid #3d3d3d' }}
    >
      {/* Esquerda: ícone + nome */}
      <div className="flex items-center gap-3">
        <NotebookPen size={18} className="text-emerald-500" />
        <span className="text-[13px] font-medium" style={{ color: '#969696' }}>
          {activeNote
            ? `${activeNote.title.length > 40 ? activeNote.title.slice(0, 40) + '...' : activeNote.title} - Ops Notas`
            : 'Ops Notas'}
        </span>
      </div>

      {/* Direita: controles da janela */}
      <div className="titlebar-no-drag flex items-center">
        <button
          onClick={() => window.electronAPI.window.minimize()}
          className="flex h-9 w-[46px] items-center justify-center transition-colors duration-150"
          style={{ color: '#969696' }}
          onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = '#333333'; e.currentTarget.style.color = '#cccccc' }}
          onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; e.currentTarget.style.color = '#969696' }}
          title="Minimizar"
        >
          <Minus size={16} />
        </button>

        <button
          onClick={handleMaximize}
          className="flex h-9 w-[46px] items-center justify-center transition-colors duration-150"
          style={{ color: '#969696' }}
          onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = '#333333'; e.currentTarget.style.color = '#cccccc' }}
          onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; e.currentTarget.style.color = '#969696' }}
          title={isMaximized ? 'Restaurar' : 'Maximizar'}
        >
          {isMaximized ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
        </button>

        <button
          onClick={() => window.electronAPI.window.close()}
          className="flex h-9 w-[46px] items-center justify-center transition-colors duration-150 hover:bg-[#e81123] hover:text-white"
          style={{ color: '#969696' }}
          title="Fechar"
        >
          <X size={16} />
        </button>
      </div>
    </div>
  )
}
