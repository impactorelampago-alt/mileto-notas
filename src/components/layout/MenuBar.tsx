import { useEffect } from 'react'
import { LogOut } from 'lucide-react'
import { useOpsStore, OpsSection } from '../../stores/ops-store'
import { useNotesStore } from '../../stores/notes-store'
import { useAuthStore } from '../../stores/auth-store'
import { supabase } from '../../lib/supabase'

export function MenuBar() {
  const { sections, tasks, loadOpsData } = useOpsStore()
  const { openTab, fetchNoteById } = useNotesStore()
  const { signOut } = useAuthStore()

  useEffect(() => {
    void loadOpsData()
  }, [])

  const handleSectionClick = async (section: OpsSection) => {
    const sectionTasks = tasks.filter(t => t.status.endsWith(section.key_suffix))
    if (sectionTasks.length === 0) return

    // Fechar todas as abas abertas
    const { openTabs, closeTab } = useNotesStore.getState()
    ;[...openTabs].forEach(tabId => closeTab(tabId))

    const taskIds = sectionTasks.map(t => t.id)

    const { data: notesData } = await supabase
      .from('notes')
      .select('id, task_id')
      .in('task_id', taskIds)

    if (!notesData || notesData.length === 0) return

    for (const noteRef of notesData) {
      await fetchNoteById(noteRef.id)
      openTab(noteRef.id)
    }
  }

  return (
    <div
      className="relative flex items-center h-8 px-2 gap-3 select-none"
      style={{ borderBottom: '1px solid #1a2a1a', backgroundColor: '#0a0a0a' }}
    >
      {sections.map((section) => (
        <button
          key={section.label}
          onClick={() => void handleSectionClick(section)}
          className="flex items-center gap-1.5 px-3 py-0.5 rounded text-[12px] transition-colors hover:bg-zinc-800"
          style={{ color: '#a1a1aa' }}
        >
          <span
            className="w-2 h-2 rounded-full flex-shrink-0"
            style={{ backgroundColor: section.color }}
          />
          {section.label}
        </button>
      ))}

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
