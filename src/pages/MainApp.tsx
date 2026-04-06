import { useState, useEffect } from 'react'
import { useAuthStore } from '../stores/auth-store'
import Titlebar from '../components/layout/Titlebar'
import MenuBar from '../components/layout/MenuBar'
import Sidebar from '../components/layout/Sidebar'
import TabBar from '../components/layout/TabBar'
import StatusBar from '../components/layout/StatusBar'
import Editor from '../components/editor/Editor'
import SearchBar from '../components/editor/SearchBar'

export default function MainApp() {
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated)
  const [searchBarVisible, setSearchBarVisible] = useState(false)

  useEffect(() => {
    if (!isAuthenticated) return

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.key === 'f') {
        e.preventDefault()
        setSearchBarVisible((prev) => !prev)
      }
      if (e.key === 'Escape') {
        setSearchBarVisible(false)
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isAuthenticated])

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
