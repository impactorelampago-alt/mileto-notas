import { create } from 'zustand'

export type SubnoteSide = 'left' | 'right'
export const SUBNOTE_MIN_WIDTH = 190
export const SUBNOTE_MAX_WIDTH = 520
const SUBNOTE_DEFAULT_WIDTH = 240
const LS_SUBNOTE_SIDE = 'notas:subnote-side'
const LS_SUBNOTE_COLLAPSED = 'notas:subnote-collapsed'
const LS_SUBNOTE_WIDTH = 'notas:subnote-width'
function lsGet(k: string): string | null {
  try { return localStorage.getItem(k) } catch { return null }
}
function lsSet(k: string, v: string): void {
  try { localStorage.setItem(k, v) } catch { /* storage indisponível — ignora */ }
}
function readSubnoteWidth(): number {
  const n = Number(lsGet(LS_SUBNOTE_WIDTH))
  return Number.isFinite(n) && n >= SUBNOTE_MIN_WIDTH && n <= SUBNOTE_MAX_WIDTH ? n : SUBNOTE_DEFAULT_WIDTH
}

interface UIState {
  searchQuery: string
  wordWrap: boolean
  showLineNumbers: boolean
  showStatusBar: boolean
  fontSize: number
  searchBarVisible: boolean
  cursorLine: number
  cursorColumn: number
  showCategoryModal: boolean
  assignCategoryNoteId: string | null
  editingCategoryId: string | null
  showCollaboratorsModal: boolean
  showSharedNotesModal: boolean
  showDeleteNoteModal: boolean
  deleteSectionKeySuffix: string | null
  showConnectModal: boolean
  connectModalTab: 'empresa' | 'tarefa'
  showQuickSearch: boolean
  saveState: 'idle' | 'saving' | 'saved'
  sharePickerTarget: { kind: 'category' | 'note'; id: string; label: string } | null
  // Painel de subnotas (preferências persistidas em localStorage)
  subnoteSide: SubnoteSide
  subnoteCollapsed: boolean
  subnoteWidth: number
  setSearchQuery: (q: string) => void
  toggleWordWrap: () => void
  toggleLineNumbers: () => void
  toggleStatusBar: () => void
  increaseFontSize: () => void
  decreaseFontSize: () => void
  resetFontSize: () => void
  setSearchBarVisible: (v: boolean) => void
  setCursor: (line: number, column: number) => void
  setShowCategoryModal: (v: boolean) => void
  setAssignCategoryNoteId: (id: string | null) => void
  setEditingCategoryId: (id: string | null) => void
  setShowCollaboratorsModal: (v: boolean) => void
  setShowSharedNotesModal: (v: boolean) => void
  setShowDeleteNoteModal: (v: boolean) => void
  setDeleteSectionKeySuffix: (suffix: string | null) => void
  setShowConnectModal: (v: boolean) => void
  setConnectModalTab: (tab: 'empresa' | 'tarefa') => void
  setShowQuickSearch: (v: boolean) => void
  setSaveState: (s: 'idle' | 'saving' | 'saved') => void
  setSharePickerTarget: (t: { kind: 'category' | 'note'; id: string; label: string } | null) => void
  toggleSubnoteSide: () => void
  toggleSubnoteCollapsed: () => void
  setSubnoteWidth: (w: number) => void
}

const FONT_MIN = 10
const FONT_MAX = 24
const FONT_DEFAULT = 14

export const useUIStore = create<UIState>()((set) => ({
  searchQuery: '',
  wordWrap: true,
  showLineNumbers: false,
  showStatusBar: true,
  fontSize: FONT_DEFAULT,
  searchBarVisible: false,
  cursorLine: 1,
  cursorColumn: 1,
  showCategoryModal: false,
  assignCategoryNoteId: null,
  editingCategoryId: null,
  showCollaboratorsModal: false,
  showSharedNotesModal: false,
  showDeleteNoteModal: false,
  deleteSectionKeySuffix: null,
  showConnectModal: false,
  connectModalTab: 'empresa' as const,
  showQuickSearch: false,
  saveState: 'idle',
  sharePickerTarget: null,
  subnoteSide: lsGet(LS_SUBNOTE_SIDE) === 'right' ? 'right' : 'left',
  subnoteCollapsed: lsGet(LS_SUBNOTE_COLLAPSED) === '1',
  subnoteWidth: readSubnoteWidth(),
  setSearchQuery: (q) => set({ searchQuery: q }),
  toggleWordWrap: () => set((s) => ({ wordWrap: !s.wordWrap })),
  toggleLineNumbers: () => set((s) => ({ showLineNumbers: !s.showLineNumbers })),
  toggleStatusBar: () => set((s) => ({ showStatusBar: !s.showStatusBar })),
  increaseFontSize: () => set((s) => ({ fontSize: Math.min(s.fontSize + 1, FONT_MAX) })),
  decreaseFontSize: () => set((s) => ({ fontSize: Math.max(s.fontSize - 1, FONT_MIN) })),
  resetFontSize: () => set({ fontSize: FONT_DEFAULT }),
  setSearchBarVisible: (v) => set({ searchBarVisible: v }),
  setCursor: (line, column) => set({ cursorLine: line, cursorColumn: column }),
  setShowCategoryModal: (v) => set({ showCategoryModal: v }),
  setAssignCategoryNoteId: (id) => set({ assignCategoryNoteId: id }),
  setEditingCategoryId: (id) => set({ editingCategoryId: id }),
  setShowCollaboratorsModal: (v) => set({ showCollaboratorsModal: v }),
  setShowSharedNotesModal: (v) => set({ showSharedNotesModal: v }),
  setShowDeleteNoteModal: (v) => set({ showDeleteNoteModal: v }),
  setDeleteSectionKeySuffix: (suffix) => set({ deleteSectionKeySuffix: suffix }),
  setShowConnectModal: (v) => set({ showConnectModal: v }),
  setConnectModalTab: (tab) => set({ connectModalTab: tab }),
  setShowQuickSearch: (v) => set({ showQuickSearch: v }),
  setSaveState: (s) => set({ saveState: s }),
  setSharePickerTarget: (t) => set({ sharePickerTarget: t }),
  toggleSubnoteSide: () =>
    set((s) => {
      const next: SubnoteSide = s.subnoteSide === 'left' ? 'right' : 'left'
      lsSet(LS_SUBNOTE_SIDE, next)
      return { subnoteSide: next }
    }),
  toggleSubnoteCollapsed: () =>
    set((s) => {
      const next = !s.subnoteCollapsed
      lsSet(LS_SUBNOTE_COLLAPSED, next ? '1' : '0')
      return { subnoteCollapsed: next }
    }),
  setSubnoteWidth: (w) => {
    const clamped = Math.min(SUBNOTE_MAX_WIDTH, Math.max(SUBNOTE_MIN_WIDTH, Math.round(w)))
    lsSet(LS_SUBNOTE_WIDTH, String(clamped))
    set({ subnoteWidth: clamped })
  },
}))
