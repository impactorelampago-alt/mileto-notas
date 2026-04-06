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
          className="shrink-0 border-b border-zinc-700 bg-zinc-900 px-4 py-2"
        >
          {/* Linha de busca */}
          <div className="flex items-center gap-2">
            <input
              type="text"
              placeholder="Buscar..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              autoFocus
              className="h-7 w-56 rounded bg-zinc-800 px-3 text-xs text-zinc-300 placeholder:text-zinc-600 outline-none ring-1 ring-transparent transition-all duration-150 focus:ring-emerald-500/50"
            />

            <span className="text-xs text-zinc-600">0 de 0</span>

            <button
              title="Diferenciar maiúsculas e minúsculas"
              onClick={() => setCaseSensitive((prev) => !prev)}
              className={`flex h-7 w-7 items-center justify-center rounded text-xs font-semibold transition-colors duration-150 ${
                caseSensitive
                  ? 'bg-emerald-600 text-white'
                  : 'text-zinc-400 hover:bg-zinc-700 hover:text-zinc-200'
              }`}
            >
              Aa
            </button>

            <button
              title="Resultado anterior"
              className="flex h-7 w-7 items-center justify-center rounded text-zinc-400 transition-colors duration-150 hover:bg-zinc-700 hover:text-zinc-200"
            >
              <ChevronUp size={14} />
            </button>

            <button
              title="Próximo resultado"
              className="flex h-7 w-7 items-center justify-center rounded text-zinc-400 transition-colors duration-150 hover:bg-zinc-700 hover:text-zinc-200"
            >
              <ChevronDown size={14} />
            </button>

            <button
              onClick={onClose}
              title="Fechar"
              className="ml-auto flex h-7 w-7 items-center justify-center rounded text-zinc-400 transition-colors duration-150 hover:bg-zinc-700 hover:text-zinc-200"
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
              className="h-7 w-56 rounded bg-zinc-800 px-3 text-xs text-zinc-300 placeholder:text-zinc-600 outline-none ring-1 ring-transparent transition-all duration-150 focus:ring-emerald-500/50"
            />

            <button className="h-7 rounded bg-zinc-700 px-3 text-xs text-zinc-300 transition-colors duration-150 hover:bg-zinc-600 hover:text-zinc-100">
              Substituir
            </button>

            <button className="h-7 rounded bg-zinc-700 px-3 text-xs text-zinc-300 transition-colors duration-150 hover:bg-zinc-600 hover:text-zinc-100">
              Substituir todos
            </button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
