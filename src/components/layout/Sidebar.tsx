import { useState } from 'react'
import { Search, Plus, FileText } from 'lucide-react'

interface MockCategory {
  id: string
  name: string
  color: string
  count: number
}

const MOCK_CATEGORIES: MockCategory[] = [
  { id: '1', name: 'Pessoal', color: '#22c55e', count: 4 },
  { id: '2', name: 'Trabalho', color: '#3b82f6', count: 12 },
  { id: '3', name: 'Ideias', color: '#a855f7', count: 7 },
]

const HDivider = () => (
  <div
    style={{
      height: '1px',
      flexShrink: 0,
      background: 'linear-gradient(90deg, transparent, rgba(16, 185, 129, 0.4), transparent)',
    }}
  />
)

export default function Sidebar() {
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState('')

  return (
    <div
      className="flex w-[220px] shrink-0 flex-col bg-zinc-900"
      style={{ boxShadow: '1px 0 0 0 rgba(16, 185, 129, 0.35)' }}
    >
      {/* Campo de busca */}
      <div className="px-2 py-2">
        <div className="relative">
          <Search
            size={13}
            className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-zinc-500"
          />
          <input
            type="text"
            placeholder="Buscar..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full text-zinc-300 placeholder:text-zinc-600 outline-none transition-colors duration-150"
            style={{
              backgroundColor: '#27272a',
              border: '1px solid #3f3f46',
              borderRadius: '8px',
              height: '32px',
              fontSize: '12px',
              paddingLeft: '30px',
              paddingRight: '8px',
            }}
          />
        </div>
      </div>

      <HDivider />

      {/* Header de categorias */}
      <div className="flex items-center justify-between px-2 py-[6px]">
        <span
          className="text-[11px] font-medium text-zinc-500"
          style={{ letterSpacing: '0.5px' }}
        >
          Categorias
        </span>
        <button
          className="flex h-5 w-5 items-center justify-center rounded-md text-zinc-500 transition-colors duration-150 hover:bg-zinc-700 hover:text-zinc-300"
          title="Nova categoria"
        >
          <Plus size={13} />
        </button>
      </div>

      {/* Lista de categorias */}
      <div className="flex flex-col px-2 pb-2">
        {/* Todas as notas */}
        <button
          onClick={() => setSelectedCategory(null)}
          className="mb-0.5 flex w-full items-center gap-2 rounded px-2 text-[12px] transition-colors duration-150 hover:bg-zinc-800/60"
          style={{
            height: '30px',
            borderLeft: selectedCategory === null ? '2px solid #10b981' : '2px solid transparent',
            backgroundColor: selectedCategory === null ? '#27272a' : 'transparent',
            color: selectedCategory === null ? '#f4f4f5' : '#a1a1aa',
          }}
        >
          <FileText size={13} className="shrink-0" />
          <span className="flex-1 text-left">Todas as notas</span>
          <span className="text-[11px] text-zinc-600">23</span>
        </button>

        {MOCK_CATEGORIES.map((category) => (
          <button
            key={category.id}
            onClick={() => setSelectedCategory(category.id)}
            className="mb-0.5 flex w-full items-center gap-2 rounded px-2 text-[12px] transition-colors duration-150 hover:bg-zinc-800/60"
            style={{
              height: '30px',
              borderLeft:
                selectedCategory === category.id
                  ? '2px solid #10b981'
                  : '2px solid transparent',
              backgroundColor:
                selectedCategory === category.id ? '#27272a' : 'transparent',
              color: selectedCategory === category.id ? '#f4f4f5' : '#a1a1aa',
            }}
          >
            <span
              className="h-2 w-2 shrink-0 rounded-full"
              style={{ backgroundColor: category.color }}
            />
            <span className="flex-1 text-left">{category.name}</span>
            <span className="text-[11px] text-zinc-600">{category.count}</span>
          </button>
        ))}
      </div>
    </div>
  )
}
