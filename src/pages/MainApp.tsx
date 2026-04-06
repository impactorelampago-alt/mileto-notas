import { useEffect } from 'react'
import { useAuthStore } from '../stores/auth-store'
import { useNotesStore } from '../stores/notes-store'
import { useUIStore } from '../stores/ui-store'
import Titlebar from '../components/layout/Titlebar'
import MenuBar from '../components/layout/MenuBar'
import Sidebar from '../components/layout/Sidebar'
import TabBar from '../components/layout/TabBar'
import StatusBar from '../components/layout/StatusBar'
import Editor from '../components/editor/Editor'
import SearchBar from '../components/editor/SearchBar'

export default function MainApp() {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated)
  const loadNotes = useNotesStore((s) => s.loadNotes)
  const searchBarVisible = useUIStore((s) => s.searchBarVisible)
  const setSearchBarVisible = useUIStore((s) => s.setSearchBarVisible)

  useEffect(() => {
    if (!isAuthenticated) return
    void loadNotes()
  }, [isAuthenticated, loadNotes])

  if (!isAuthenticated) return null

  return (
    <div className="flex h-screen flex-col overflow-hidden">
      <Titlebar />
      <MenuBar />
      <div className="flex flex-1 overflow-hidden">
        <Sidebar />
        <div className="flex flex-1 flex-col overflow-hidden">
          <TabBar />
          <SearchBar
            visible={searchBarVisible}
            onClose={() => setSearchBarVisible(false)}
          />
          <Editor />
          <StatusBar />
        </div>
      </div>
    </div>
  )
}
