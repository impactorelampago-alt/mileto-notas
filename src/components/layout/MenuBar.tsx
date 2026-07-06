import { useMemo, useRef, useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Check, ChevronDown, Circle, LogOut, Plus, X } from 'lucide-react'
import { useAuthStore } from '../../stores/auth-store'
import { useOpsStore } from '../../stores/ops-store'
import { useNotesStore } from '../../stores/notes-store'
import { isStatusSuffix } from '../../lib/status-keys'

const SECTION_COLORS = [
  '#3b82f6', '#10b981', '#ef4444', '#f59e0b',
  '#8b5cf6', '#ec4899', '#f97316', '#06b6d4',
]

type SectionGroup = {
  key: string
  label: string
  color: string
  noteIds: string[]
}

export function MenuBar() {
  const signOut = useAuthStore((s) => s.signOut)
  const sections = useOpsStore((s) => s.sections)
  const activeSectionId = useOpsStore((s) => s.activeSectionId)
  const setActiveSectionId = useOpsStore((s) => s.setActiveSectionId)
  const createSection = useOpsStore((s) => s.createSection)
  const tasks = useOpsStore((s) => s.tasks)
  const notes = useNotesStore((s) => s.notes)

  const [isOpen, setIsOpen] = useState(false)
  const [isCreatingSection, setIsCreatingSection] = useState(false)
  const [newSectionLabel, setNewSectionLabel] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)

  const sectionInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (isCreatingSection) sectionInputRef.current?.focus()
  }, [isCreatingSection])

  const taskToSectionMap = useMemo(() => {
    const map = new Map<string, string>()
    for (const task of tasks) {
      const section = sections.find((item) => isStatusSuffix(task.status, item.key_suffix))
      if (section) map.set(task.id, section.key_suffix)
    }
    return map
  }, [tasks, sections])

  const sectionGroups = useMemo<SectionGroup[]>(() => {
    const groups = new Map<string, SectionGroup>()
    for (const section of sections) {
      groups.set(section.key_suffix, {
        key: section.key_suffix,
        label: section.label,
        color: section.color,
        noteIds: [],
      })
    }
    for (const note of notes) {
      if (!note.task_id || note.parent_note_id !== null) continue
      const sectionKey = taskToSectionMap.get(note.task_id)
      if (!sectionKey) continue
      groups.get(sectionKey)?.noteIds.push(note.id)
    }
    return sections.map((s) => groups.get(s.key_suffix)!).filter(Boolean)
  }, [notes, sections, taskToSectionMap])

  const activeGroup = useMemo(
    () => sectionGroups.find((g) => g.key === activeSectionId) ?? null,
    [sectionGroups, activeSectionId],
  )

  const handleSelectSection = (key: string) => {
    setActiveSectionId(key)
    setIsOpen(false)
    setIsCreatingSection(false)
  }

  const handleCreateSection = async () => {
    const label = newSectionLabel.trim()
    if (!label || isSubmitting) return
    setIsSubmitting(true)
    const autoColor = SECTION_COLORS[sections.length % SECTION_COLORS.length]
    const success = await createSection(label, autoColor)
    setIsSubmitting(false)
    if (success) {
      setNewSectionLabel('')
      setIsCreatingSection(false)
    }
  }

  const handleCancelCreateSection = () => {
    setNewSectionLabel('')
    setIsCreatingSection(false)
  }

  return (
    <div
      className="select-none"
      style={{ backgroundColor: '#0a0a0a', borderBottom: '1px solid #1f1f1f' }}
    >
      {/* Header — sempre visível */}
      <div className="flex h-9 items-center justify-between px-3">
        <button
          onClick={() => setIsOpen((v) => !v)}
          className="flex items-center gap-1.5 rounded-md px-2 py-0.5 transition-colors hover:bg-zinc-900"
          style={{ minWidth: 110 }}
        >
          {activeGroup ? (
            <>
              <span style={{ width: 7, height: 7, borderRadius: '999px', backgroundColor: activeGroup.color, flexShrink: 0 }} />
              <span style={{ color: '#e4e4e7', fontSize: '11.5px', fontWeight: 500 }}>{activeGroup.label}</span>
              <span style={{ color: '#71717a', fontSize: '10.5px', marginLeft: 6, marginRight: 2 }}>
                {activeGroup.noteIds.length}
              </span>
            </>
          ) : (
            <>
              <Circle size={7} style={{ color: '#52525b' }} />
              <span style={{ color: '#a1a1aa', fontSize: '11.5px' }}>Escolher categoria</span>
            </>
          )}
          <ChevronDown
            size={11}
            style={{
              color: '#71717a',
              marginLeft: 2,
              transform: isOpen ? 'rotate(180deg)' : 'rotate(0deg)',
              transition: 'transform 180ms ease',
            }}
          />
        </button>

        <button
          onClick={() => void signOut()}
          className="flex items-center gap-1 rounded px-2 py-0.5 text-[11px] transition-colors hover:bg-zinc-900 hover:text-red-400"
          style={{ color: '#6d6d6d' }}
        >
          <LogOut size={11} />
          Sair
        </button>
      </div>

      {/* Accordion — expande inline empurrando o conteúdo abaixo */}
      <AnimatePresence initial={false}>
        {isOpen && (
          <motion.div
            key="accordion"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.18, ease: 'easeInOut' }}
            style={{ overflow: 'hidden', borderTop: '1px solid #1a1a1a' }}
          >
            {/* Grid de seções */}
            <div
              className="grid gap-1 p-2"
              style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))' }}
            >
              {sectionGroups.map((group) => {
                const isActive = group.key === activeSectionId
                return (
                  <button
                    key={group.key}
                    onClick={() => handleSelectSection(group.key)}
                    className="flex items-center gap-2 rounded-md px-3 py-1.5 text-left transition-colors hover:bg-zinc-800"
                    style={{
                      backgroundColor: isActive ? '#1a2920' : 'transparent',
                      border: `1px solid ${isActive ? '#2d4a3a' : 'transparent'}`,
                    }}
                  >
                    <span style={{ width: 8, height: 8, borderRadius: '999px', backgroundColor: group.color, flexShrink: 0 }} />
                    <span
                      className="flex-1 truncate"
                      style={{ color: isActive ? '#d1fae5' : '#e4e4e7', fontSize: '12px' }}
                    >
                      {group.label}
                    </span>
                    <span style={{ color: '#52525b', fontSize: '11px', flexShrink: 0 }}>
                      {group.noteIds.length}
                    </span>
                  </button>
                )
              })}
            </div>

            {/* Criar nova seção */}
            <div style={{ borderTop: '1px solid #1a1a1a', padding: '6px 8px 8px' }}>
              {isCreatingSection ? (
                <div className="flex flex-col gap-2 px-1">
                  <div className="flex items-center gap-1.5">
                    <input
                      ref={sectionInputRef}
                      value={newSectionLabel}
                      onChange={(e) => setNewSectionLabel(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') void handleCreateSection()
                        if (e.key === 'Escape') handleCancelCreateSection()
                      }}
                      placeholder="Nome da categoria..."
                      className="flex-1 rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-[12px] text-zinc-200 outline-none focus:border-zinc-500"
                    />
                    <button
                      onClick={() => void handleCreateSection()}
                      disabled={isSubmitting || !newSectionLabel.trim()}
                      className="flex items-center justify-center rounded p-1 text-emerald-400 transition-colors disabled:opacity-40"
                    >
                      <Check size={14} />
                    </button>
                    <button
                      onClick={handleCancelCreateSection}
                      className="flex items-center justify-center rounded p-1 text-zinc-500 transition-colors hover:text-zinc-300"
                    >
                      <X size={14} />
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  onClick={() => setIsCreatingSection(true)}
                  className="flex items-center gap-2 rounded px-2 py-1.5 text-left transition-colors hover:bg-zinc-800"
                >
                  <Plus size={12} style={{ color: '#71717a' }} />
                  <span style={{ color: '#a1a1aa', fontSize: '12px' }}>Nova categoria</span>
                </button>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

export default MenuBar
