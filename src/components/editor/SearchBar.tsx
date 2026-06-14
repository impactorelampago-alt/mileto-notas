import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { ChevronUp, ChevronDown, X } from 'lucide-react'

interface SearchBarProps {
  visible: boolean
  onClose: () => void
}

export default function SearchBar({ visible, onClose }: SearchBarProps) {
  const [searchQuery, setSearchQuery] = useState('')
  const [replaceQuery, setReplaceQuery] = useState('')
  const [caseSensitive, setCaseSensitive] = useState(false)

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          transition={{ duration: 0.15 }}
          className="shrink-0 px-4 py-2"
          style={{ backgroundColor: '#333333', borderBottom: '1px solid #3d3d3d' }}
        >
          {/* Linha de busca */}
          <div className="flex items-center gap-2">
            <input
              type="text"
              placeholder="Buscar..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              autoFocus
              className="h-7 w-56 rounded px-3 text-xs outline-none ring-1 ring-transparent transition-all duration-150 focus:ring-emerald-500/50"
              style={{ backgroundColor: '#2d2d2d', border: '1px solid #3d3d3d', color: '#cccccc' }}
            />

            <span className="text-xs" style={{ color: '#6d6d6d' }}>0 de 0</span>

            <button
              title="Diferenciar maiúsculas e minúsculas"
              onClick={() => setCaseSensitive((prev) => !prev)}
              className={`flex h-7 w-7 items-center justify-center rounded text-xs font-semibold transition-colors duration-150 ${
                caseSensitive
                  ? 'bg-emerald-600 text-white'
                  : 'hover:text-zinc-200'
              }`}
              style={!caseSensitive ? { color: '#969696' } : undefined}
              onMouseEnter={(e) => { if (!caseSensitive) e.currentTarget.style.backgroundColor = '#3d3d3d' }}
              onMouseLeave={(e) => { if (!caseSensitive) e.currentTarget.style.backgroundColor = 'transparent' }}
            >
              Aa
            </button>

            <button
              title="Resultado anterior"
              className="flex h-7 w-7 items-center justify-center rounded transition-colors duration-150"
              style={{ color: '#969696' }}
              onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = '#3d3d3d'; e.currentTarget.style.color = '#cccccc' }}
              onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; e.currentTarget.style.color = '#969696' }}
            >
              <ChevronUp size={14} />
            </button>

            <button
              title="Próximo resultado"
              className="flex h-7 w-7 items-center justify-center rounded transition-colors duration-150"
              style={{ color: '#969696' }}
              onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = '#3d3d3d'; e.currentTarget.style.color = '#cccccc' }}
              onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; e.currentTarget.style.color = '#969696' }}
            >
              <ChevronDown size={14} />
            </button>

            <button
              onClick={onClose}
              title="Fechar"
              className="ml-auto flex h-7 w-7 items-center justify-center rounded transition-colors duration-150"
              style={{ color: '#969696' }}
              onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = '#3d3d3d'; e.currentTarget.style.color = '#cccccc' }}
              onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; e.currentTarget.style.color = '#969696' }}
            >
              <X size={14} />
            </button>
          </div>

          {/* Linha de substituição */}
          <div className="mt-1.5 flex items-center gap-2">
            <input
              type="text"
              placeholder="Substituir..."
              value={replaceQuery}
              onChange={(e) => setReplaceQuery(e.target.value)}
              className="h-7 w-56 rounded px-3 text-xs outline-none ring-1 ring-transparent transition-all duration-150 focus:ring-emerald-500/50"
              style={{ backgroundColor: '#2d2d2d', border: '1px solid #3d3d3d', color: '#cccccc' }}
            />

            <button
              className="h-7 rounded px-3 text-xs transition-colors duration-150"
              style={{ backgroundColor: '#3d3d3d', color: '#cccccc' }}
              onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = '#4d4d4d' }}
              onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = '#3d3d3d' }}
            >
              Substituir
            </button>

            <button
              className="h-7 rounded px-3 text-xs transition-colors duration-150"
              style={{ backgroundColor: '#3d3d3d', color: '#cccccc' }}
              onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = '#4d4d4d' }}
              onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = '#3d3d3d' }}
            >
              Substituir todos
            </button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
