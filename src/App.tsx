import { useEffect } from 'react'
import { useAuthStore } from './stores/auth-store'
import { useNotesStore } from './stores/notes-store'
import { saveDraft, saveSession } from './lib/local-drafts'
import Login from './pages/Login'
import MainApp from './pages/MainApp'

export default function App() {
  const isLoading = useAuthStore((state) => state.isLoading)
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated)
  const initialize = useAuthStore((state) => state.initialize)

  useEffect(() => {
    initialize()
  }, [initialize])

  useEffect(() => {
    window.electronAPI.onBeforeClose(async () => {
      const { notes, openTabs, activeTabId, updateNote } = useNotesStore.getState()
      try {
        // 1. Rede de segurança LOCAL primeiro (rápida, invisível, nunca perde):
        //    grava a sessão (abas) e o rascunho de cada nota aberta.
        await saveSession({ openTabs, activeTabId })
        await Promise.all(
          openTabs.map((id) => {
            const note = notes.find((n) => n.id === id)
            return note
              ? saveDraft(note.id, { content: note.content, title: note.title, savedAt: note.updated_at })
              : Promise.resolve()
          }),
        )
        // 2. Depois tenta sincronizar com a nuvem (best-effort).
        await Promise.all(
          openTabs.map((id) => {
            const note = notes.find((n) => n.id === id)
            return note
              ? updateNote(note.id, { content: note.content, title: note.title })
              : Promise.resolve()
          }),
        )
      } catch (err) {
        console.error('[close] Falha ao salvar antes de fechar — fechando mesmo assim:', err)
      } finally {
        // Garantia: o app SEMPRE fecha, mesmo que os saves acima falhem.
        window.electronAPI.closeApp()
      }
    })
  }, [])

  if (isLoading) {
    return (
      <div className="flex h-screen items-center justify-center bg-zinc-950">
        <div className="flex flex-col items-center gap-4">
          <img
            src="./logo.png"
            alt="Mileto Notas"
            className="h-20 w-20 animate-pulse object-contain"
            style={{ filter: 'drop-shadow(0 4px 18px rgba(16,185,129,0.28))' }}
          />
          <span className="text-sm text-zinc-500">Carregando...</span>
        </div>
      </div>
    )
  }

  return isAuthenticated ? <MainApp /> : <Login />
}
