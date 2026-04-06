import { useState, useEffect } from 'react'
import { Minus, Maximize2, Minimize2, X, NotebookPen } from 'lucide-react'

export default function Titlebar() {
  const [isMaximized, setIsMaximized] = useState(false)

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
      className="titlebar-drag flex h-9 shrink-0 items-center justify-between bg-zinc-900 px-2"
      style={{ boxShadow: '0 1px 0 0 rgba(16, 185, 129, 0.4)' }}
    >
      {/* Esquerda: ícone + nome */}
      <div className="flex items-center gap-2 pl-1">
        <NotebookPen size={15} className="text-emerald-500" />
        <span className="text-[13px] font-medium text-zinc-400">Ops Notas</span>
      </div>

      {/* Direita: controles da janela */}
      <div className="titlebar-no-drag flex items-center">
        <button
          onClick={() => window.electronAPI.window.minimize()}
          className="flex h-9 w-[46px] items-center justify-center text-zinc-400 transition-colors duration-150 hover:bg-zinc-700 hover:text-zinc-100"
          title="Minimizar"
        >
          <Minus size={16} />
        </button>

        <button
          onClick={handleMaximize}
          className="flex h-9 w-[46px] items-center justify-center text-zinc-400 transition-colors duration-150 hover:bg-zinc-700 hover:text-zinc-100"
          title={isMaximized ? 'Restaurar' : 'Maximizar'}
        >
          {isMaximized ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
        </button>

        <button
          onClick={() => window.electronAPI.window.close()}
          className="flex h-9 w-[46px] items-center justify-center text-zinc-400 transition-colors duration-150 hover:bg-[#e81123] hover:text-white"
          title="Fechar"
        >
          <X size={16} />
        </button>
      </div>
    </div>
  )
}
