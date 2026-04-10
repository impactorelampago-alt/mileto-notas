import { create } from 'zustand'

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
  showConnectModal: boolean
  connectModalTab: 'empresa' | 'tarefa'
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
  setShowConnectModal: (v: boolean) => void
  setConnectModalTab: (tab: 'empresa' | 'tarefa') => void
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
  showConnectModal: false,
  connectModalTab: 'empresa' as const,
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
  setShowConnectModal: (v) => set({ showConnectModal: v }),
  setConnectModalTab: (tab) => set({ connectModalTab: tab }),
}))
