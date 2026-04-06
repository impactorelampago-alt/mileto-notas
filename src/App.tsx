import { useEffect } from 'react'
import { NotebookPen } from 'lucide-react'
import { useAuthStore } from './stores/auth-store'
import Login from './pages/Login'
import MainApp from './pages/MainApp'

export default function App() {
  const isLoading = useAuthStore((state) => state.isLoading)
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated)
  const initialize = useAuthStore((state) => state.initialize)

  useEffect(() => {
    initialize()
  }, [initialize])

  if (isLoading) {
    return (
      <div className="flex h-screen items-center justify-center bg-zinc-950">
        <div className="flex flex-col items-center gap-3">
          <NotebookPen size={32} className="animate-pulse text-emerald-500" />
          <span className="text-sm text-zinc-500">Carregando...</span>
        </div>
      </div>
    )
  }

  return isAuthenticated ? <MainApp /> : <Login />
}
