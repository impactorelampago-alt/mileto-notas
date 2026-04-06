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
  setSearchQuery: (q: string) => void
  toggleWordWrap: () => void
  toggleLineNumbers: () => void
  toggleStatusBar: () => void
  increaseFontSize: () => void
  decreaseFontSize: () => void
  resetFontSize: () => void
  setSearchBarVisible: (v: boolean) => void
  setCursor: (line: number, column: number) => void
}

const FONT_MIN = 10
const FONT_MAX = 24
const FONT_DEFAULT = 14

export const useUIStore = create<UIState>()((set) => ({
  searchQuery: '',
  wordWrap: true,
  showLineNumbers: true,
  showStatusBar: true,
  fontSize: FONT_DEFAULT,
  searchBarVisible: false,
  cursorLine: 1,
  cursorColumn: 1,
  setSearchQuery: (q) => set({ searchQuery: q }),
  toggleWordWrap: () => set((s) => ({ wordWrap: !s.wordWrap })),
  toggleLineNumbers: () => set((s) => ({ showLineNumbers: !s.showLineNumbers })),
  toggleStatusBar: () => set((s) => ({ showStatusBar: !s.showStatusBar })),
  increaseFontSize: () => set((s) => ({ fontSize: Math.min(s.fontSize + 1, FONT_MAX) })),
  decreaseFontSize: () => set((s) => ({ fontSize: Math.max(s.fontSize - 1, FONT_MIN) })),
  resetFontSize: () => set({ fontSize: FONT_DEFAULT }),
  setSearchBarVisible: (v) => set({ searchBarVisible: v }),
  setCursor: (line, column) => set({ cursorLine: line, cursorColumn: column }),
}))
