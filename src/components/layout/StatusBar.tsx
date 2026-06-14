import { useNotesStore } from '../../stores/notes-store'
import { useUIStore } from '../../stores/ui-store'

export default function StatusBar() {
  const showStatusBar = useUIStore((s) => s.showStatusBar)
  const cursorLine = useUIStore((s) => s.cursorLine)
  const cursorColumn = useUIStore((s) => s.cursorColumn)
  const wordWrap = useUIStore((s) => s.wordWrap)
  const saveState = useUIStore((s) => s.saveState)
  const charCount = useNotesStore(
    (s) => s.notes.find((n) => n.id === s.activeTabId)?.content.length ?? 0,
  )

  if (!showStatusBar) return null

  const cellStyle = { color: '#7d7d85', fontVariantNumeric: 'tabular-nums' as const, whiteSpace: 'nowrap' as const }

  return (
    <div
      className="flex h-7 shrink-0 items-center justify-between"
      style={{ backgroundColor: '#1a1a1a', borderTop: '1px solid #353535', paddingLeft: '16px', paddingRight: '16px' }}
    >
      <span className="text-xs" style={cellStyle}>
        Ln {cursorLine}, Col {cursorColumn}
      </span>
      <span className="text-xs" style={cellStyle}>{charCount} caracteres</span>
      <div className="flex items-center" style={{ gap: '14px', whiteSpace: 'nowrap' }}>
        {saveState !== 'idle' && (
          <>
            <span className="flex items-center gap-1.5 text-xs" style={{ color: saveState === 'saved' ? '#34d399' : '#7d7d85' }}>
              <span style={{ width: 6, height: 6, borderRadius: 999, backgroundColor: saveState === 'saved' ? '#10b981' : '#6d6d75' }} />
              {saveState === 'saved' ? 'Salvo' : 'Salvando…'}
            </span>
            <span className="text-xs" style={{ color: '#4a4a4a' }}>|</span>
          </>
        )}
        <span className="text-xs" style={{ color: '#7d7d85' }}>UTF-8</span>
        <span className="text-xs" style={{ color: '#4a4a4a' }}>|</span>
        <span className="text-xs" style={{ color: '#7d7d85' }}>
          Quebra: {wordWrap ? 'On' : 'Off'}
        </span>
      </div>
    </div>
  )
}
