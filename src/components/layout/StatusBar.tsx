import { useNotesStore } from '../../stores/notes-store'
import { useUIStore } from '../../stores/ui-store'

export default function StatusBar() {
  const showStatusBar = useUIStore((s) => s.showStatusBar)
  const cursorLine = useUIStore((s) => s.cursorLine)
  const cursorColumn = useUIStore((s) => s.cursorColumn)
  const wordWrap = useUIStore((s) => s.wordWrap)
  const charCount = useNotesStore(
    (s) => s.notes.find((n) => n.id === s.activeTabId)?.content.length ?? 0,
  )

  if (!showStatusBar) return null

  return (
    <div
      className="flex h-7 shrink-0 items-center justify-between bg-zinc-900 px-4"
      style={{ boxShadow: '0 -1px 0 0 rgba(16, 185, 129, 0.2)' }}
    >
      <span className="text-xs text-zinc-500">
        Ln {cursorLine}, Col {cursorColumn}
      </span>
      <span className="text-xs text-zinc-500">{charCount} caracteres</span>
      <div className="flex items-center gap-1">
        <span className="text-xs text-zinc-500">UTF-8</span>
        <span className="text-xs text-zinc-700">·</span>
        <span className="text-xs text-zinc-500">
          Quebra automática: {wordWrap ? 'On' : 'Off'}
        </span>
      </div>
    </div>
  )
}
