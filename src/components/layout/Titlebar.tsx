import { useState, useEffect } from 'react'
import { Minus, Maximize2, Minimize2, X, Search } from 'lucide-react'
import CategorySelect from './CategorySelect'
import AccountSwitcher from './AccountSwitcher'
import NotificationBell from './NotificationBell'
import SyncStatus from './SyncStatus'
import { useUIStore } from '../../stores/ui-store'

export default function Titlebar() {
  const [isMaximized, setIsMaximized] = useState(false)
  const setShowQuickSearch = useUIStore((s) => s.setShowQuickSearch)

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
      className="titlebar-drag flex h-10 shrink-0 items-center justify-between pl-[14px] pr-0"
      style={{ backgroundColor: '#1a1a1a', borderBottom: '1px solid #2a2a2a' }}
    >
      {/* Esquerda: logo (com respiro) + nome + seletor de categoria */}
      <div className="flex items-center">
        <div className="flex h-6 w-6 items-center justify-center" title="Mileto Ops Notas">
          <img
            src="./logo.png"
            alt="Mileto Notas"
            className="h-5 w-5 object-contain"
            style={{ filter: 'drop-shadow(0 1px 2px rgba(0,0,0,0.4))' }}
          />
        </div>
        <span
          className="text-[12.5px] font-medium"
          style={{ color: '#a1a1aa', marginLeft: 10, letterSpacing: '0.2px' }}
        >
          Mileto Ops Notas
        </span>
        <div style={{ width: 1, height: 14, backgroundColor: '#2a2a2a', marginLeft: 12, marginRight: 10 }} />
        <CategorySelect />
      </div>

      {/* Direita: sino + trocar de conta + busca + controles da janela */}
      <div className="titlebar-no-drag flex items-center">
        <SyncStatus />
        <NotificationBell />
        <div style={{ width: 1, height: 16, backgroundColor: '#2a2a2a', margin: '0 8px' }} />
        <AccountSwitcher />
        <div style={{ width: 1, height: 16, backgroundColor: '#2a2a2a', margin: '0 8px' }} />
        <button
          onClick={() => setShowQuickSearch(true)}
          className="flex h-7 w-9 items-center justify-center rounded-md"
          style={{ color: '#969696', marginRight: 8, transition: 'background-color 140ms, color 140ms' }}
          onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = '#232323'; e.currentTarget.style.color = '#e4e4e4' }}
          onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; e.currentTarget.style.color = '#969696' }}
          title="Buscar (Ctrl+K)"
        >
          <Search size={15} />
        </button>
        <button
          onClick={() => window.electronAPI.window.minimize()}
          className="flex h-10 w-[46px] items-center justify-center"
          style={{ color: '#969696', transition: 'background-color 140ms, color 140ms' }}
          onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = '#232323'; e.currentTarget.style.color = '#e4e4e4' }}
          onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; e.currentTarget.style.color = '#969696' }}
          title="Minimizar"
        >
          <Minus size={16} />
        </button>

        <button
          onClick={handleMaximize}
          className="flex h-10 w-[46px] items-center justify-center"
          style={{ color: '#969696', transition: 'background-color 140ms, color 140ms' }}
          onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = '#232323'; e.currentTarget.style.color = '#e4e4e4' }}
          onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; e.currentTarget.style.color = '#969696' }}
          title={isMaximized ? 'Restaurar' : 'Maximizar'}
        >
          {isMaximized ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
        </button>

        <button
          onClick={() => window.electronAPI.window.close()}
          className="flex h-10 w-[46px] items-center justify-center"
          style={{ color: '#969696', transition: 'background-color 140ms, color 140ms' }}
          onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = '#e81123'; e.currentTarget.style.color = '#ffffff' }}
          onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; e.currentTarget.style.color = '#969696' }}
          onMouseDown={(e) => { e.currentTarget.style.backgroundColor = '#c50f1f' }}
          onMouseUp={(e) => { e.currentTarget.style.backgroundColor = '#e81123' }}
          title="Fechar"
        >
          <X size={16} />
        </button>
      </div>
    </div>
  )
}
