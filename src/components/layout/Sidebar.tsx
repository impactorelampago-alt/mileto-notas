import { useEffect, useRef, useState } from 'react'
import { Building2, CheckSquare, Users, Search, FileText } from 'lucide-react'
import { useNotesStore } from '../../stores/notes-store'
import { useUIStore } from '../../stores/ui-store'
import { FIXED_CATEGORIES } from '../../lib/types'
import type { FixedCategory } from '../../lib/types'
import { formatDistanceToNow } from 'date-fns'
import { ptBR } from 'date-fns/locale'

const CATEGORY_ICONS = {
  empresas: Building2,
  tarefas: CheckSquare,
  equipe: Users,
} as const

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
  const { notes, loadNotes, openTab } = useNotesStore()
  const { searchQuery, setSearchQuery, selectedCategory, setSelectedCategory } = useUIStore()
  const [dropdownVisible, setDropdownVisible] = useState(false)
  const searchRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    void loadNotes()
  }, [loadNotes])

  // Fechar dropdown ao clicar fora
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) {
        setDropdownVisible(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const searchResults = searchQuery.trim()
    ? notes.filter((n) => n.title.toLowerCase().includes(searchQuery.toLowerCase()))
    : []

  const handleResultClick = (noteId: string) => {
    openTab(noteId)
    setSearchQuery('')
    setDropdownVisible(false)
  }

  const getCategoryLabel = (categoryId: string | null) => {
    if (!categoryId) return null
    return FIXED_CATEGORIES.find((c) => c.id === categoryId)?.label ?? null
  }

  return (
    <div
      className="flex w-[220px] shrink-0 flex-col bg-zinc-900"
      style={{ boxShadow: '1px 0 0 0 rgba(16, 185, 129, 0.35)' }}
    >
      {/* Campo de busca */}
      <div className="px-2 py-2" ref={searchRef}>
        <div className="relative">
          <Search
            size={13}
            className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-zinc-500"
          />
          <input
            type="text"
            placeholder="Buscar notas..."
            value={searchQuery}
            onChange={(e) => {
              setSearchQuery(e.target.value)
              setDropdownVisible(true)
            }}
            onFocus={() => { if (searchQuery.trim()) setDropdownVisible(true) }}
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

          {/* Dropdown de resultados */}
          {dropdownVisible && searchQuery.trim() && (
            <div
              className="no-scrollbar absolute left-0 top-full z-50 mt-1 w-full overflow-y-auto rounded-lg py-1"
              style={{
                backgroundColor: '#18181b',
                boxShadow: '0 0 0 1px rgba(16,185,129,0.35), 0 4px 16px rgba(0,0,0,0.4)',
                maxHeight: '300px',
              }}
            >
              {searchResults.length === 0 ? (
                <p className="px-3 py-2 text-[11px] text-zinc-600">Nenhuma nota encontrada</p>
              ) : (
                searchResults.map((note) => (
                  <button
                    key={note.id}
                    onMouseDown={() => handleResultClick(note.id)}
                    className="flex w-full flex-col px-3 py-2 text-left transition-colors duration-150 hover:bg-zinc-800"
                  >
                    <span className="truncate text-[12px] text-zinc-100">{note.title}</span>
                    <div className="mt-0.5 flex items-center gap-2">
                      {getCategoryLabel(note.category_id) && (
                        <span className="text-[10px] text-zinc-500">
                          {getCategoryLabel(note.category_id)}
                        </span>
                      )}
                      <span className="text-[10px] text-zinc-600">
                        {formatDistanceToNow(new Date(note.updated_at), {
                          addSuffix: true,
                          locale: ptBR,
                        })}
                      </span>
                    </div>
                  </button>
                ))
              )}
            </div>
          )}
        </div>
      </div>

      <HDivider />

      {/* Categorias fixas */}
      <div className="flex flex-col px-2 py-1.5">
        {/* Todas as notas */}
        <button
          onClick={() => setSelectedCategory(null)}
          className="mb-0.5 flex w-full items-center gap-2 rounded px-2 text-[12px] transition-colors duration-150 hover:bg-zinc-800/60"
          style={{
            height: '32px',
            borderLeft: selectedCategory === null ? '2px solid #10b981' : '2px solid transparent',
            backgroundColor: selectedCategory === null ? '#27272a' : 'transparent',
            color: selectedCategory === null ? '#f4f4f5' : '#a1a1aa',
          }}
        >
          <FileText size={13} className="shrink-0" style={{ color: '#a1a1aa' }} />
          <span className="flex-1 text-left">Todas as notas</span>
          <span className="text-[11px] text-zinc-600">{notes.length}</span>
        </button>

        {FIXED_CATEGORIES.map((cat) => {
          const Icon = CATEGORY_ICONS[cat.id as FixedCategory]
          const isSelected = selectedCategory === cat.id
          return (
            <button
              key={cat.id}
              onClick={() => setSelectedCategory(cat.id)}
              className="mb-0.5 flex w-full items-center gap-2 rounded px-2 text-[12px] transition-colors duration-150 hover:bg-zinc-800/60"
              style={{
                height: '32px',
                borderLeft: isSelected ? '2px solid #10b981' : '2px solid transparent',
                backgroundColor: isSelected ? '#27272a' : 'transparent',
                color: isSelected ? '#f4f4f5' : '#a1a1aa',
              }}
            >
              <Icon size={13} className="shrink-0" style={{ color: cat.color }} />
              <span className="flex-1 text-left">{cat.label}</span>
              <span className="text-[11px] text-zinc-600">
                {notes.filter((n) => n.category_id === cat.id).length}
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
