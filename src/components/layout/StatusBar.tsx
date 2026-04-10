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
      className="flex h-7 shrink-0 items-center justify-between"
      style={{ backgroundColor: '#252526', borderTop: '1px solid #3d3d3d', paddingLeft: '16px', paddingRight: '20px' }}
    >
      <span className="text-xs" style={{ color: '#6d6d6d', whiteSpace: 'nowrap' }}>
        Ln {cursorLine}, Col {cursorColumn}
      </span>
      <span className="text-xs" style={{ color: '#6d6d6d', whiteSpace: 'nowrap' }}>{charCount} caracteres</span>
      <div className="flex items-center gap-3" style={{ whiteSpace: 'nowrap' }}>
        <span className="text-xs" style={{ color: '#6d6d6d' }}>UTF-8</span>
        <span className="text-xs" style={{ color: '#4d4d4d' }}>|</span>
        <span className="text-xs" style={{ color: '#6d6d6d' }}>
          Quebra: {wordWrap ? 'On' : 'Off'}
        </span>
      </div>
    </div>
  )
}
