import { useState, useRef, useEffect } from 'react'
import type { LucideIcon } from 'lucide-react'
import {
  FilePlus, AppWindow, Clock, Save, FileDown, Pin, Archive,
  X, XCircle, LogOut,
  Undo2, Redo2, Scissors, Copy, Clipboard, CheckSquare, Search, Replace, WrapText,
  ZoomIn, ZoomOut, RotateCcw, Hash, PanelBottom, Moon,
} from 'lucide-react'

interface MenuItem {
  label: string
  icon: LucideIcon
  shortcut?: string
  disabled?: boolean
  toggle?: boolean
  toggleValue?: boolean
  checkmark?: boolean
}

type MenuSection = MenuItem[]

interface MenuDef {
  key: string
  label: string
  sections: MenuSection[]
}

const FILE_MENU: MenuSection[] = [
  [
    { label: 'Nova nota',      icon: FilePlus,  shortcut: 'Ctrl+N' },
    { label: 'Nova janela',    icon: AppWindow, shortcut: 'Ctrl+Shift+N' },
    { label: 'Abrir recentes', icon: Clock,     disabled: true },
  ],
  [
    { label: 'Salvar',            icon: Save,     shortcut: 'Ctrl+S' },
    { label: 'Exportar como .txt', icon: FileDown, shortcut: 'Ctrl+Shift+S' },
  ],
  [
    { label: 'Fixar nota',    icon: Pin },
    { label: 'Arquivar nota', icon: Archive },
  ],
  [
    { label: 'Fechar nota',         icon: X,       shortcut: 'Ctrl+W' },
    { label: 'Fechar todas as notas', icon: XCircle },
  ],
  [
    { label: 'Sair', icon: LogOut, shortcut: 'Ctrl+Q' },
  ],
]

const EDIT_MENU: MenuSection[] = [
  [
    { label: 'Desfazer', icon: Undo2,  shortcut: 'Ctrl+Z' },
    { label: 'Refazer',  icon: Redo2,  shortcut: 'Ctrl+Shift+Z' },
  ],
  [
    { label: 'Recortar',     icon: Scissors,    shortcut: 'Ctrl+X' },
    { label: 'Copiar',       icon: Copy,        shortcut: 'Ctrl+C' },
    { label: 'Colar',        icon: Clipboard,   shortcut: 'Ctrl+V' },
    { label: 'Selecionar tudo', icon: CheckSquare, shortcut: 'Ctrl+A' },
  ],
  [
    { label: 'Buscar',     icon: Search,  shortcut: 'Ctrl+F' },
    { label: 'Substituir', icon: Replace, shortcut: 'Ctrl+H' },
  ],
  [
    { label: 'Quebra automática', icon: WrapText, toggle: true, toggleValue: true },
  ],
]

const VIEW_MENU: MenuSection[] = [
  [
    { label: 'Aumentar fonte', icon: ZoomIn,    shortcut: 'Ctrl+=' },
    { label: 'Diminuir fonte', icon: ZoomOut,   shortcut: 'Ctrl+-' },
    { label: 'Fonte padrão',   icon: RotateCcw, shortcut: 'Ctrl+0' },
  ],
  [
    { label: 'Mostrar números de linha', icon: Hash,        toggle: true, toggleValue: true },
    { label: 'Mostrar barra de status',  icon: PanelBottom, toggle: true, toggleValue: true },
  ],
  [
    { label: 'Tema escuro', icon: Moon, checkmark: true },
  ],
]

const MENUS: MenuDef[] = [
  { key: 'arquivo', label: 'Arquivo', sections: FILE_MENU },
  { key: 'editar',  label: 'Editar',  sections: EDIT_MENU },
  { key: 'exibir',  label: 'Exibir',  sections: VIEW_MENU },
]

const DropdownDivider = () => (
  <div
    style={{
      height: '1px',
      margin: '4px 8px',
      background: 'linear-gradient(90deg, transparent, rgba(16, 185, 129, 0.4), transparent)',
    }}
  />
)

export default function MenuBar() {
  const [openMenu, setOpenMenu] = useState<string | null>(null)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpenMenu(null)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const handleMenuClick = (key: string) =>
    setOpenMenu((prev) => (prev === key ? null : key))

  const handleItemClick = () => setOpenMenu(null)

  return (
    <div
      ref={ref}
      className="relative z-40 flex h-7 shrink-0 items-center gap-1 bg-zinc-900 pl-2"
      style={{ boxShadow: '0 1px 0 0 rgba(16, 185, 129, 0.4)' }}
    >
      {MENUS.map((menu) => (
        <div key={menu.key} className="relative">
          {/* Botão do menu */}
          <button
            onClick={() => handleMenuClick(menu.key)}
            onMouseEnter={() => openMenu !== null && setOpenMenu(menu.key)}
            className={`flex h-7 items-center rounded-md px-3 text-[13px] transition-colors duration-150 ${
              openMenu === menu.key
                ? 'bg-zinc-800 text-zinc-200'
                : 'text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200'
            }`}
          >
            {menu.label}
          </button>

          {/* Dropdown */}
          {openMenu === menu.key && (
            <div
              className="absolute left-0 top-full mt-0.5 min-w-[240px] rounded-lg py-1"
              style={{
                backgroundColor: '#18181b',
                boxShadow: '0 0 0 1px rgba(16, 185, 129, 0.4), 0 4px 16px rgba(0, 0, 0, 0.4)',
              }}
            >
              {menu.sections.map((section, sectionIdx) => (
                <div key={sectionIdx}>
                  {sectionIdx > 0 && <DropdownDivider />}
                  {section.map((item, itemIdx) => {
                    const Icon = item.icon
                    if (item.disabled) {
                      return (
                        <div
                          key={itemIdx}
                          className="flex w-full items-center gap-3 px-3 py-2"
                          style={{ cursor: 'default' }}
                        >
                          <Icon size={15} className="text-zinc-700 shrink-0" />
                          <span className="flex-1 text-[13px] text-zinc-600">{item.label}</span>
                        </div>
                      )
                    }
                    return (
                      <button
                        key={itemIdx}
                        onClick={handleItemClick}
                        className="flex w-full items-center gap-3 px-3 py-2 text-left transition-colors duration-150 hover:bg-zinc-800"
                      >
                        <Icon size={15} className="shrink-0 text-zinc-500" />
                        <span className="flex-1 text-[13px] text-zinc-300">{item.label}</span>
                        {item.shortcut && (
                          <span className="text-[12px] text-zinc-600">{item.shortcut}</span>
                        )}
                        {item.toggle && (
                          <span
                            className="text-[12px]"
                            style={{ color: item.toggleValue ? '#10b981' : '#71717a' }}
                          >
                            {item.toggleValue ? 'On' : 'Off'}
                          </span>
                        )}
                        {item.checkmark && (
                          <span className="text-[13px]" style={{ color: '#10b981' }}>✓</span>
                        )}
                      </button>
                    )
                  })}
                </div>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  )
}
