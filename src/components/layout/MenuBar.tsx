import { LogOut } from 'lucide-react'
import { useOpsStore, OpsSection } from '../../stores/ops-store'
import { useNotesStore } from '../../stores/notes-store'
import { useAuthStore } from '../../stores/auth-store'

export function MenuBar() {
  const { sections, activeSectionId, setActiveSectionId } = useOpsStore()
  const { signOut } = useAuthStore()

  const handleSectionClick = (section: OpsSection) => {
    // 1. Set active section (UI state)
    setActiveSectionId(section.key_suffix)

    // 2. Close all currently open tabs
    const { openTabs, closeTab, notes, openTab } = useNotesStore.getState()
    ;[...openTabs].forEach((tabId) => closeTab(tabId))

    // 3. Filtrar tasks da seção usando dados já em memória no store
    const { tasks } = useOpsStore.getState()
    const sectionTasks = tasks.filter((t) => t.status.endsWith(section.key_suffix))
    if (sectionTasks.length === 0) return

    // 4. Filtrar notas vinculadas às tasks usando dados já em memória
    const taskIds = new Set(sectionTasks.map((t) => t.id))
    const sectionNotes = notes.filter((n) => n.task_id !== null && taskIds.has(n.task_id))
    if (sectionNotes.length === 0) return

    // 5. Abrir cada nota como aba
    for (const note of sectionNotes) {
      openTab(note.id)
    }
  }

  return (
    <div
      className="relative flex items-center h-8 px-2 gap-3 select-none"
      style={{ borderBottom: '1px solid #1a2a1a', backgroundColor: '#0a0a0a' }}
    >
      {sections.map((section) => {
        const isActive = activeSectionId === section.key_suffix

        return (
          <button
            key={section.key_suffix}
            onClick={() => handleSectionClick(section)}
            className="flex items-center gap-1.5 px-3 py-0.5 rounded text-[12px] transition-colors hover:bg-zinc-800"
            style={{
              color: isActive ? '#e4e4e7' : '#a1a1aa',
              backgroundColor: isActive ? '#27272a' : 'transparent',
            }}
          >
            <span
              className="w-2 h-2 rounded-full flex-shrink-0"
              style={{ backgroundColor: section.color }}
            />
            {section.label}
          </button>
        )
      })}

      <button
        onClick={() => void signOut()}
        style={{ position: 'absolute', right: '8px' }}
        className="flex items-center gap-1 px-2 py-0.5 rounded text-[11px] text-zinc-600 hover:text-red-400 hover:bg-zinc-900 transition-colors"
      >
        <LogOut size={11} />
        Sair
      </button>
    </div>
  )
}

export default MenuBar
