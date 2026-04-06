import { useState } from 'react'
import { X, Plus } from 'lucide-react'

interface MockTab {
  id: string
  title: string
}

const MOCK_TABS: MockTab[] = [
  { id: '1', title: 'Reunião com cliente' },
  { id: '2', title: 'Lista de tarefas' },
]

export default function TabBar() {
  const [activeTab, setActiveTab] = useState('1')
  const [hoveredTab, setHoveredTab] = useState<string | null>(null)

  if (MOCK_TABS.length === 0) {
    return (
      <div
        className="flex h-9 shrink-0 items-center justify-center bg-zinc-950"
        style={{ boxShadow: '0 1px 0 0 rgba(16, 185, 129, 0.2)' }}
      >
        <span className="text-[12px] text-zinc-600">Nenhuma nota aberta</span>
      </div>
    )
  }

  return (
    <div
      className="flex h-9 shrink-0 items-end bg-zinc-950 pl-1"
      style={{ boxShadow: '0 1px 0 0 rgba(16, 185, 129, 0.4)' }}
    >
      {MOCK_TABS.map((tab) => {
        const isActive = tab.id === activeTab
        const isHovered = tab.id === hoveredTab

        return (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            onMouseEnter={() => setHoveredTab(tab.id)}
            onMouseLeave={() => setHoveredTab(null)}
            className="group relative flex h-9 max-w-[180px] items-center gap-2 px-4 transition-colors duration-150"
            style={
              isActive
                ? {
                    backgroundColor: '#18181b',
                    borderBottom: '2px solid #10b981',
                    color: '#f4f4f5',
                  }
                : {
                    backgroundColor: isHovered ? 'rgba(24, 24, 27, 0.5)' : 'transparent',
                    color: isHovered ? '#d4d4d8' : '#71717a',
                  }
            }
          >
            <span className="max-w-[120px] truncate text-[13px]">{tab.title}</span>
            {(isActive || isHovered) && (
              <span
                onClick={(e) => {
                  e.stopPropagation()
                }}
                className="flex h-4 w-4 shrink-0 items-center justify-center rounded text-zinc-500 transition-colors duration-150 hover:text-zinc-300"
              >
                <X size={12} />
              </span>
            )}
          </button>
        )
      })}

      {/* Botão nova aba */}
      <button className="flex h-9 w-9 shrink-0 items-center justify-center text-zinc-600 transition-colors duration-150 hover:bg-zinc-900/50 hover:text-zinc-400">
        <Plus size={14} />
      </button>
    </div>
  )
}
