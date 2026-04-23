import { useMemo, useRef, useState, useEffect } from 'react'
import { Check, ChevronDown, Circle, LogOut, Plus, X } from 'lucide-react'
import { useAuthStore } from '../../stores/auth-store'
import { useOpsStore } from '../../stores/ops-store'
import { useNotesStore } from '../../stores/notes-store'

const SECTION_COLORS = [
  '#3b82f6', '#10b981', '#ef4444', '#f59e0b',
  '#8b5cf6', '#ec4899', '#f97316', '#06b6d4',
]

type SectionGroup = {
  key: string
  label: string
  color: string
  noteIds: string[]
  isLoose?: boolean
}

export function MenuBar() {
  const signOut = useAuthStore((s) => s.signOut)
  const sections = useOpsStore((s) => s.sections)
  const activeSectionId = useOpsStore((s) => s.activeSectionId)
  const setActiveSectionId = useOpsStore((s) => s.setActiveSectionId)
  const createSection = useOpsStore((s) => s.createSection)
  const tasks = useOpsStore((s) => s.tasks)
  const notes = useNotesStore((s) => s.notes)

  const [isDropdownOpen, setIsDropdownOpen] = useState(false)
  const [isCreatingSection, setIsCreatingSection] = useState(false)
  const [newSectionLabel, setNewSectionLabel] = useState('')
  const [newSectionColor, setNewSectionColor] = useState(SECTION_COLORS[0])
  const [isSubmitting, setIsSubmitting] = useState(false)

  const dropdownRef = useRef<HTMLDivElement>(null)
  const sectionInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!isDropdownOpen) return
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsDropdownOpen(false)
        setIsCreatingSection(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [isDropdownOpen])

  useEffect(() => {
    if (isCreatingSection) sectionInputRef.current?.focus()
  }, [isCreatingSection])

  const taskToSectionMap = useMemo(() => {
    const map = new Map<string, string>()
    for (const task of tasks) {
      const section = sections.find((item) => task.status.endsWith(item.key_suffix))
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
      if (!note.task_id) continue
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

  const selectableSections = sectionGroups

  const handleSelectSection = (key: string) => {
    setActiveSectionId(key)
    setIsDropdownOpen(false)
    setIsCreatingSection(false)
  }

  const handleCreateSection = async () => {
    const label = newSectionLabel.trim()
    if (!label || isSubmitting) return
    setIsSubmitting(true)
    const success = await createSection(label, newSectionColor)
    setIsSubmitting(false)
    if (success) {
      setNewSectionLabel('')
      setNewSectionColor(SECTION_COLORS[0])
      setIsCreatingSection(false)
    }
  }

  const handleCancelCreateSection = () => {
    setNewSectionLabel('')
    setNewSectionColor(SECTION_COLORS[0])
    setIsCreatingSection(false)
  }

  return (
    <div
      className="flex h-9 items-center justify-between px-3 select-none"
      style={{ borderBottom: '1px solid #1f1f1f', backgroundColor: '#0a0a0a' }}
    >
      <div ref={dropdownRef} className="relative">
        <button
          onClick={() => setIsDropdownOpen((v) => !v)}
          className="flex items-center gap-1.5 rounded-md px-2 py-0.5 transition-colors hover:bg-zinc-900"
          style={{ minWidth: 110 }}
        >
          {activeGroup ? (
            <>
              <span style={{ width: 7, height: 7, borderRadius: '999px', backgroundColor: activeGroup.color }} />
              <span style={{ color: '#e4e4e7', fontSize: '11.5px', fontWeight: 500 }}>{activeGroup.label}</span>
              <span style={{ color: '#71717a', fontSize: '10.5px', marginLeft: 'auto', marginRight: 2 }}>
                {activeGroup.noteIds.length}
              </span>
            </>
          ) : (
            <>
              <Circle size={7} style={{ color: '#52525b' }} />
              <span style={{ color: '#a1a1aa', fontSize: '11.5px' }}>Escolher categoria</span>
              <span style={{ marginLeft: 'auto' }} />
            </>
          )}
          <ChevronDown
            size={11}
            style={{
              color: '#71717a',
              transform: isDropdownOpen ? 'rotate(180deg)' : 'rotate(0deg)',
              transition: 'transform 150ms ease',
            }}
          />
        </button>

        {isDropdownOpen && (
          <div
            className="absolute left-0 top-full mt-1 z-50 overflow-hidden"
            style={{
              minWidth: 260,
              backgroundColor: '#18181b',
              border: '1px solid #2c2c2c',
              borderRadius: '10px',
              boxShadow: '0 8px 24px rgba(0,0,0,0.45)',
            }}
          >
            <div style={{ maxHeight: 320, overflowY: 'auto' }}>
              {selectableSections.map((group) => {
                const isActive = group.key === activeSectionId
                return (
                  <button
                    key={group.key}
                    onClick={() => handleSelectSection(group.key)}
                    className="flex w-full items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-zinc-800"
                    style={{ backgroundColor: isActive ? '#232a26' : 'transparent' }}
                  >
                    <span style={{ width: 10, height: 10, borderRadius: '999px', backgroundColor: group.color }} />
                    <span style={{ color: '#e4e4e7', fontSize: '12.5px', flex: 1 }}>{group.label}</span>
                    <span style={{ color: '#71717a', fontSize: '11px' }}>{group.noteIds.length}</span>
                  </button>
                )
              })}

            </div>

            <div style={{ borderTop: '1px solid #27272a', padding: 6 }}>
              {isCreatingSection ? (
                <div className="flex flex-col gap-2 p-1">
                  <div className="flex items-center gap-1">
                    {SECTION_COLORS.map((color) => (
                      <button
                        key={color}
                        onClick={() => setNewSectionColor(color)}
                        className="h-3.5 w-3.5 rounded-full transition-transform"
                        style={{
                          backgroundColor: color,
                          outline: color === newSectionColor ? '2px solid #e4e4e7' : 'none',
                          outlineOffset: '1px',
                          transform: color === newSectionColor ? 'scale(1.2)' : 'scale(1)',
                        }}
                      />
                    ))}
                  </div>
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
                      className="flex items-center justify-center rounded p-1 text-zinc-500 transition-colors hover:bg-zinc-800 hover:text-zinc-300"
                    >
                      <X size={14} />
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  onClick={() => setIsCreatingSection(true)}
                  className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left transition-colors hover:bg-zinc-800"
                >
                  <Plus size={12} style={{ color: '#71717a' }} />
                  <span style={{ color: '#a1a1aa', fontSize: '12px' }}>Nova categoria</span>
                </button>
              )}
            </div>
          </div>
        )}
      </div>

      <button
        onClick={() => void signOut()}
        className="flex items-center gap-1 rounded px-2 py-0.5 text-[11px] transition-colors hover:bg-zinc-900 hover:text-red-400"
        style={{ color: '#6d6d6d' }}
      >
        <LogOut size={11} />
        Sair
      </button>
    </div>
  )
}

export default MenuBar
