import { useState, useRef, useEffect } from 'react'
import type { LucideIcon } from 'lucide-react'
import {
  FilePlus, AppWindow, Clock, Save, FileDown, Pin, PinOff, Archive,
  X, XCircle, LogOut,
  Undo2, Redo2, Scissors, Copy, Clipboard, CheckSquare, Search, Replace, WrapText,
  ZoomIn, ZoomOut, RotateCcw, Hash, PanelBottom,
  FolderPlus, Tag, Unlink, FolderOpen, Filter, Pencil, Trash2, Eye,
  Users, Link, Inbox, Building2,
} from 'lucide-react'
import { useNotesStore } from '../../stores/notes-store'
import { useAuthStore } from '../../stores/auth-store'
import { useUIStore } from '../../stores/ui-store'
import { useCategoriesStore } from '../../stores/categories-store'

interface MenuItem {
  label: string
  icon?: LucideIcon
  colorDot?: string
  shortcut?: string
  disabled?: boolean
  toggle?: boolean
  toggleValue?: boolean
  checkmark?: boolean
  onClick?: () => void
}

type MenuSection = MenuItem[]

interface MenuDef {
  key: string
  label: string
  sections: MenuSection[]
}

const DropdownDivider = () => (
  <div
    style={{
      height: '1px',
      margin: '6px 8px',
      backgroundColor: '#3d3d3d',
    }}
  />
)

export default function MenuBar() {
  const [openMenu, setOpenMenu] = useState<string | null>(null)
  const [hoveredCategoryId, setHoveredCategoryId] = useState<string | null>(null)
  const ref = useRef<HTMLDivElement>(null)

  const createNote = useNotesStore((s) => s.createNote)
  const closeTab = useNotesStore((s) => s.closeTab)
  const closeAllTabs = useNotesStore((s) => s.closeAllTabs)
  const activeTabId = useNotesStore((s) => s.activeTabId)
  const updateNote = useNotesStore((s) => s.updateNote)
  const signOut = useAuthStore((s) => s.signOut)
  const {
    wordWrap, showLineNumbers, showStatusBar,
    toggleWordWrap, toggleLineNumbers, toggleStatusBar,
    increaseFontSize, decreaseFontSize, resetFontSize,
    searchBarVisible, setSearchBarVisible,
    setShowCategoryModal, setAssignCategoryNoteId, setEditingCategoryId,
    setShowCollaboratorsModal, setShowSharedNotesModal, setShowDeleteNoteModal,
    setShowConnectModal, setConnectModalTab,
  } = useUIStore()
  const categories = useCategoriesStore((s) => s.categories)
  const deleteCategory = useCategoriesStore((s) => s.deleteCategory)
  const openTab = useNotesStore((s) => s.openTab)
  const setActiveTab = useNotesStore((s) => s.setActiveTab)
  const allNotes = useNotesStore((s) => s.notes)
  const activeNote = useNotesStore((s) => s.notes.find((n) => n.id === s.activeTabId) ?? null)

  const exportAsTxt = () => {
    const note = useNotesStore.getState().notes.find((n) => n.id === activeTabId)
    if (!note) return
    const blob = new Blob([note.content], { type: 'text/plain;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${note.title || 'nota'}.txt`
    a.click()
    URL.revokeObjectURL(url)
  }

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!e.ctrlKey) return
      switch (e.key) {
        case 'n':
          e.preventDefault()
          void createNote()
          break
        case 's':
          e.preventDefault()
          window.dispatchEvent(new Event('force-save'))
          break
        case 'w':
          e.preventDefault()
          if (activeTabId) closeTab(activeTabId)
          break
        case 'f':
          e.preventDefault()
          setSearchBarVisible(!searchBarVisible)
          break
        case 'q':
          e.preventDefault()
          void signOut().catch(console.error)
          break
        case '=':
          e.preventDefault()
          increaseFontSize()
          break
        case '-':
          e.preventDefault()
          decreaseFontSize()
          break
        case '0':
          e.preventDefault()
          resetFontSize()
          break
        case 'S':
          // Ctrl+Shift+S
          if (e.shiftKey) {
            e.preventDefault()
            exportAsTxt()
          }
          break
        case 'P':
          // Ctrl+Shift+P
          if (e.shiftKey) {
            e.preventDefault()
            if (activeTabId) setShowCollaboratorsModal(true)
          }
          break
        case 'M':
          // Ctrl+Shift+M
          if (e.shiftKey) {
            e.preventDefault()
            setShowSharedNotesModal(true)
          }
          break
        case 'C':
          // Ctrl+Shift+C
          if (e.shiftKey) {
            e.preventDefault()
            setShowCategoryModal(true)
          }
          break
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [
    activeTabId, createNote, closeTab, searchBarVisible,
    setSearchBarVisible, signOut, increaseFontSize, decreaseFontSize, resetFontSize,
    setShowCategoryModal, exportAsTxt, setShowCollaboratorsModal, setShowSharedNotesModal,
  ])

  // Click outside closes menu
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpenMenu(null)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const FILE_MENU: MenuSection[] = [
    [
      { label: 'Nova nota', icon: FilePlus, shortcut: 'Ctrl+N', onClick: () => { void createNote() } },
      { label: 'Nova janela', icon: AppWindow, shortcut: 'Ctrl+Shift+N', onClick: () => window.electronAPI.window.newWindow() },
      { label: 'Abrir recentes', icon: Clock, disabled: true },
    ],
    [
      { label: 'Salvar', icon: Save, shortcut: 'Ctrl+S', onClick: () => window.dispatchEvent(new Event('force-save')) },
      { label: 'Exportar como .txt', icon: FileDown, shortcut: 'Ctrl+Shift+S', disabled: !activeNote, onClick: exportAsTxt },
    ],
    [
      {
        label: activeNote?.is_pinned ? 'Desafixar nota' : 'Fixar nota',
        icon: activeNote?.is_pinned ? PinOff : Pin,
        disabled: !activeNote,
        onClick: () => { if (activeTabId && activeNote) void updateNote(activeTabId, { is_pinned: !activeNote.is_pinned }) },
      },
      {
        label: 'Arquivar nota',
        icon: Archive,
        disabled: !activeNote,
        onClick: () => { if (activeTabId) { void updateNote(activeTabId, { is_archived: true }); closeTab(activeTabId) } },
      },
      {
        label: 'Excluir nota',
        icon: Trash2,
        disabled: !activeNote,
        onClick: () => setShowDeleteNoteModal(true),
      },
    ],
    [
      { label: 'Fechar nota', icon: X, shortcut: 'Ctrl+W', onClick: () => { if (activeTabId) closeTab(activeTabId) } },
      { label: 'Fechar todas as notas', icon: XCircle, onClick: closeAllTabs },
    ],
    [
      {
        label: 'Sair da conta', icon: LogOut, shortcut: 'Ctrl+Q',
        onClick: () => { void signOut().catch(console.error) },
      },
      {
        label: 'Fechar aplicativo', icon: X,
        onClick: () => window.electronAPI.window.close(),
      },
    ],
  ]

  const EDIT_MENU: MenuSection[] = [
    [
      { label: 'Desfazer', icon: Undo2, shortcut: 'Ctrl+Z', onClick: () => document.execCommand('undo') },
      { label: 'Refazer', icon: Redo2, shortcut: 'Ctrl+Shift+Z', onClick: () => document.execCommand('redo') },
    ],
    [
      { label: 'Recortar', icon: Scissors, shortcut: 'Ctrl+X', onClick: () => document.execCommand('cut') },
      { label: 'Copiar', icon: Copy, shortcut: 'Ctrl+C', onClick: () => document.execCommand('copy') },
      { label: 'Colar', icon: Clipboard, shortcut: 'Ctrl+V', onClick: () => document.execCommand('paste') },
      { label: 'Selecionar tudo', icon: CheckSquare, shortcut: 'Ctrl+A', onClick: () => window.dispatchEvent(new Event('select-all')) },
    ],
    [
      { label: 'Buscar', icon: Search, shortcut: 'Ctrl+F', onClick: () => setSearchBarVisible(true) },
      { label: 'Substituir', icon: Replace, shortcut: 'Ctrl+H', onClick: () => setSearchBarVisible(true) },
    ],
    [
      { label: 'Quebra automática', icon: WrapText, toggle: true, toggleValue: wordWrap, onClick: toggleWordWrap },
    ],
  ]

  const CATEGORY_MENU_TOP: MenuSection[] = [
    [
      {
        label: 'Fixadas', icon: Pin,
        onClick: () => {
          const pinned = allNotes.filter((n) => n.is_pinned)
          pinned.forEach((n) => openTab(n.id))
          if (pinned.length > 0) setActiveTab(pinned[0].id)
        },
      },
      {
        label: 'Compartilhadas comigo', icon: Inbox,
        onClick: () => setShowSharedNotesModal(true),
      },
    ],
    [
      { label: 'Atribuir à nota ativa', icon: Tag, onClick: () => { if (activeTabId) setAssignCategoryNoteId(activeTabId) } },
      { label: 'Remover categoria da nota', icon: Unlink, onClick: () => { if (activeTabId) void updateNote(activeTabId, { category_id: null }) } },
    ],
  ]

  const CATEGORY_MENU_BOTTOM: MenuSection[] = [
    [
      {
        label: 'Ver todas as notas', icon: Eye,
        onClick: () => {
          closeAllTabs()
          allNotes.forEach((n) => openTab(n.id))
          if (allNotes.length > 0) setActiveTab(allNotes[0].id)
        },
      },
      { label: 'Nova categoria', icon: FolderPlus, shortcut: 'Ctrl+Shift+C', onClick: () => setShowCategoryModal(true) },
    ],
  ]

  const CONNECT_MENU: MenuSection[] = [
    [
      {
        label: 'Vincular a empresa...',
        icon: Building2,
        disabled: !activeNote,
        onClick: () => { setConnectModalTab('empresa'); setShowConnectModal(true) },
      },
      {
        label: 'Vincular a tarefa...',
        icon: CheckSquare,
        disabled: !activeNote,
        onClick: () => { setConnectModalTab('tarefa'); setShowConnectModal(true) },
      },
    ],
    [
      {
        label: 'Remover vínculos',
        icon: Unlink,
        disabled: !activeNote,
        onClick: () => { if (activeTabId) void updateNote(activeTabId, { client_id: null, task_id: null }) },
      },
    ],
  ]

  const SHARE_MENU: MenuSection[] = [
    [
      {
        label: 'Notas compartilhadas comigo',
        icon: Inbox,
        shortcut: 'Ctrl+Shift+M',
        onClick: () => setShowSharedNotesModal(true),
      },
    ],
    [
      {
        label: 'Colaboradores...',
        icon: Users,
        shortcut: 'Ctrl+Shift+P',
        disabled: !activeNote,
        onClick: () => setShowCollaboratorsModal(true),
      },
    ],
    [
      { label: 'Copiar link da nota', icon: Link, disabled: true },
    ],
  ]

  const VIEW_MENU: MenuSection[] = [
    [
      { label: 'Aumentar fonte', icon: ZoomIn, shortcut: 'Ctrl+=', onClick: increaseFontSize },
      { label: 'Diminuir fonte', icon: ZoomOut, shortcut: 'Ctrl+-', onClick: decreaseFontSize },
      { label: 'Fonte padrão', icon: RotateCcw, shortcut: 'Ctrl+0', onClick: resetFontSize },
    ],
    [
      { label: 'Mostrar números de linha', icon: Hash, toggle: true, toggleValue: showLineNumbers, onClick: toggleLineNumbers },
      { label: 'Mostrar barra de status', icon: PanelBottom, toggle: true, toggleValue: showStatusBar, onClick: toggleStatusBar },
    ],
  ]

  const MENUS: MenuDef[] = [
    { key: 'arquivo', label: 'Arquivo', sections: FILE_MENU },
    { key: 'editar', label: 'Editar', sections: EDIT_MENU },
    { key: 'categorias', label: 'Categorias', sections: [...CATEGORY_MENU_TOP] },
    { key: 'conectar', label: 'Conectar', sections: CONNECT_MENU },
    { key: 'compartilhar', label: 'Compartilhar', sections: SHARE_MENU },
    { key: 'exibir', label: 'Exibir', sections: VIEW_MENU },
  ]

  const handleItemClick = (item: MenuItem) => {
    item.onClick?.()
    setOpenMenu(null)
    setHoveredCategoryId(null)
  }

  return (
    <div
      ref={ref}
      className="relative z-40 flex h-8 shrink-0 items-center gap-1.5"
      style={{ backgroundColor: '#2d2d2d', borderBottom: '1px solid #3d3d3d', paddingLeft: '12px', borderRadius: '10px', margin: '0 8px' }}
    >
      {MENUS.map((menu) => (
        <div key={menu.key} className="relative">
          <button
            onClick={() => setOpenMenu((p) => (p === menu.key ? null : menu.key))}
            onMouseEnter={(e) => {
              if (openMenu !== null) setOpenMenu(menu.key)
              if (openMenu !== menu.key) { e.currentTarget.style.backgroundColor = '#333333'; e.currentTarget.style.color = '#cccccc' }
            }}
            onMouseLeave={(e) => {
              if (openMenu !== menu.key) { e.currentTarget.style.backgroundColor = 'transparent'; e.currentTarget.style.color = '#969696' }
            }}
            className="flex h-8 items-center rounded-md px-3 text-[13px] transition-colors duration-150"
            style={{
              backgroundColor: openMenu === menu.key ? '#333333' : 'transparent',
              color: openMenu === menu.key ? '#cccccc' : '#969696',
            }}
          >
            {menu.label}
          </button>

          {openMenu === menu.key && (
            <div
              className="absolute left-0 top-full mt-0.5 min-w-[260px] py-1"
              style={{
                backgroundColor: '#2d2d2d',
                border: '1px solid #3d3d3d',
                boxShadow: '0 4px 16px rgba(0, 0, 0, 0.3)',
                borderRadius: '12px',
              }}
            >
              {menu.sections.map((section, sIdx) => (
                <div key={sIdx}>
                  {sIdx > 0 && <DropdownDivider />}
                  {section.map((item, iIdx) => {
                    if (item.disabled) {
                      return (
                        <div key={iIdx} className="flex w-full items-center gap-3 px-3 py-2.5" style={{ cursor: 'default' }}>
                          {item.icon && <item.icon size={15} className="shrink-0" style={{ color: '#4d4d4d' }} />}
                          <span className="flex-1 text-[13px]" style={{ color: '#4d4d4d' }}>{item.label}</span>
                        </div>
                      )
                    }
                    return (
                      <button
                        key={iIdx}
                        onClick={() => handleItemClick(item)}
                        className="flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors duration-150"
                        onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = '#333333' }}
                        onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent' }}
                      >
                        {item.colorDot ? (
                          <span
                            className="h-2.5 w-2.5 shrink-0 rounded-full"
                            style={{ backgroundColor: item.colorDot }}
                          />
                        ) : item.icon ? (
                          <item.icon size={15} className="shrink-0" style={{ color: '#6d6d6d' }} />
                        ) : (
                          <span className="h-[15px] w-[15px] shrink-0" />
                        )}
                        <span className="flex-1 text-[13px]" style={{ color: '#cccccc' }}>{item.label}</span>
                        {item.shortcut && <span className="text-[12px]" style={{ color: '#6d6d6d' }}>{item.shortcut}</span>}
                        {item.toggle && (
                          <span className="text-[12px]" style={{ color: item.toggleValue ? '#10b981' : '#71717a' }}>
                            {item.toggleValue ? 'On' : 'Off'}
                          </span>
                        )}
                        {item.checkmark && <span className="text-[13px]" style={{ color: '#10b981' }}>✓</span>}
                      </button>
                    )
                  })}
                </div>
              ))}

              {/* Categorias com submenu (só no menu Categorias) */}
              {menu.key === 'categorias' && (
                <>
                  <DropdownDivider />
                  {categories.length === 0 ? (
                    <div className="flex w-full items-center gap-3 px-3 py-2.5" style={{ cursor: 'default' }}>
                      <span className="flex-1 text-[13px]" style={{ color: '#4d4d4d' }}>Nenhuma categoria</span>
                    </div>
                  ) : (
                    categories.map((cat) => {
                      const count = allNotes.filter((n) => n.category_id === cat.id).length
                      return (
                        <div
                          key={cat.id}
                          className="relative"
                          onMouseEnter={() => setHoveredCategoryId(cat.id)}
                          onMouseLeave={() => setHoveredCategoryId(null)}
                        >
                          <div
                            className="flex w-full items-center gap-3 px-3 py-2.5 transition-colors duration-150"
                            style={{ cursor: 'default', backgroundColor: hoveredCategoryId === cat.id ? '#333333' : 'transparent' }}
                          >
                            <span
                              className="h-2.5 w-2.5 shrink-0 rounded-full"
                              style={{ backgroundColor: cat.color }}
                            />
                            <span className="flex-1 text-[13px]" style={{ color: '#cccccc' }}>{cat.name}</span>
                            <span className="text-[12px]" style={{ color: '#6d6d6d' }}>
                              {count > 0 ? `(${count})` : '(vazio)'}
                            </span>
                            <span className="text-[12px]" style={{ color: '#6d6d6d' }}>&#9656;</span>
                          </div>

                          {/* Submenu */}
                          {hoveredCategoryId === cat.id && (
                            <div
                              className="absolute top-0 min-w-[220px] py-1"
                              style={{
                                left: '100%',
                                backgroundColor: '#2d2d2d',
                                border: '1px solid #3d3d3d',
                                boxShadow: '0 4px 16px rgba(0, 0, 0, 0.3)',
                                borderRadius: '12px',
                              }}
                            >
                              <button
                                onClick={() => {
                                  const catNotes = allNotes.filter((n) => n.category_id === cat.id)
                                  catNotes.forEach((n) => openTab(n.id))
                                  if (catNotes.length > 0) setActiveTab(catNotes[0].id)
                                  setOpenMenu(null)
                                }}
                                className="flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors duration-150"
                                onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = '#333333' }}
                                onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent' }}
                              >
                                <FolderOpen size={15} className="shrink-0" style={{ color: '#6d6d6d' }} />
                                <span className="flex-1 text-[13px]" style={{ color: '#cccccc' }}>Abrir todas as notas</span>
                              </button>

                              <button
                                onClick={() => {
                                  closeAllTabs()
                                  const catNotes = allNotes.filter((n) => n.category_id === cat.id)
                                  catNotes.forEach((n) => openTab(n.id))
                                  if (catNotes.length > 0) setActiveTab(catNotes[0].id)
                                  setOpenMenu(null)
                                }}
                                className="flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors duration-150"
                                onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = '#333333' }}
                                onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent' }}
                              >
                                <Filter size={15} className="shrink-0" style={{ color: '#6d6d6d' }} />
                                <span className="flex-1 text-[13px]" style={{ color: '#cccccc' }}>Filtrar por esta categoria</span>
                              </button>

                              <button
                                onClick={() => {
                                  void createNote(cat.id)
                                  setOpenMenu(null)
                                }}
                                className="flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors duration-150"
                                onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = '#333333' }}
                                onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent' }}
                              >
                                <FilePlus size={15} className="shrink-0" style={{ color: '#6d6d6d' }} />
                                <span className="flex-1 text-[13px]" style={{ color: '#cccccc' }}>Nova nota aqui</span>
                              </button>

                              <DropdownDivider />

                              <button
                                onClick={() => {
                                  setEditingCategoryId(cat.id)
                                  setOpenMenu(null)
                                }}
                                className="flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors duration-150"
                                onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = '#333333' }}
                                onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent' }}
                              >
                                <Pencil size={15} className="shrink-0" style={{ color: '#6d6d6d' }} />
                                <span className="flex-1 text-[13px]" style={{ color: '#cccccc' }}>Editar categoria</span>
                              </button>

                              <button
                                onClick={() => {
                                  const confirmed = window.confirm(`Deletar a categoria "${cat.name}"? As notas permanecerão sem categoria.`)
                                  if (confirmed) {
                                    void deleteCategory(cat.id)
                                  }
                                  setOpenMenu(null)
                                }}
                                className="flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors duration-150"
                                onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = '#333333' }}
                                onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent' }}
                              >
                                <Trash2 size={15} className="shrink-0" style={{ color: '#ef4444' }} />
                                <span className="flex-1 text-[13px]" style={{ color: '#ef4444' }}>Deletar categoria</span>
                              </button>
                            </div>
                          )}
                        </div>
                      )
                    })
                  )}

                  {/* Ver todas as notas */}
                  <DropdownDivider />
                  {CATEGORY_MENU_BOTTOM[0].map((item, iIdx) => (
                    <button
                      key={iIdx}
                      onClick={() => handleItemClick(item)}
                      className="flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors duration-150"
                      onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = '#333333' }}
                      onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent' }}
                    >
                      {item.icon && <item.icon size={15} className="shrink-0" style={{ color: '#6d6d6d' }} />}
                      <span className="flex-1 text-[13px]" style={{ color: '#cccccc' }}>{item.label}</span>
                    </button>
                  ))}
                </>
              )}
            </div>
          )}
        </div>
      ))}
    </div>
  )
}
