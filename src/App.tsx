import { useEffect } from 'react'
import { useAuthStore } from './stores/auth-store'
import { useNotesStore } from './stores/notes-store'
import { useCollabStore } from './stores/collab-store'
import { useUpdateStore } from './stores/update-store'
import { saveSession } from './lib/local-drafts'
import Login from './pages/Login'
import MainApp from './pages/MainApp'
import UpdateBanner from './components/UpdateBanner'

export default function App() {
  const isLoading = useAuthStore((state) => state.isLoading)
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated)
  const initialize = useAuthStore((state) => state.initialize)

  useEffect(() => {
    initialize()
  }, [initialize])

  // Registra os listeners de atualização UMA vez (titlebar + banner leem daqui).
  useEffect(() => {
    useUpdateStore.getState().init()
  }, [])

  useEffect(() => {
    window.electronAPI.onBeforeClose(async () => {
      try {
        // 1. Descarrega a ÚLTIMA edição do editor ATIVO (o debounce de 500ms pode não
        //    ter rodado). O handler síncrono do Editor grava no store na hora + rascunho
        //    local + sobe pra nuvem — com dirty-check, então uma nota que eu só ABRI e
        //    não editei NÃO é re-enviada (senão sobrescreveria edição de outro com base velha).
        window.dispatchEvent(new Event('force-save'))
        // Co-edição: flush do snapshot CRDT pendente (ytext → notes.content + note_yjs).
        try {
          await useCollabStore.getState().close()
        } catch (error) {
          console.error('[close] Falha ao descarregar co-edição:', error)
        }
        const { openTabs, activeTabId } = useNotesStore.getState()
        // 2. Sessão (abas) — rede de segurança local, invisível.
        await saveSession({ openTabs, activeTabId })
        // 3. Sobe SÓ as edições PENDENTES (rascunhos reais de notas editadas). NÃO
        //    re-grava todas as abas às cegas — abas intocadas com base velha ficariam
        //    sobrescrevendo o que outra pessoa editou (a causa do incidente da subnota).
        //    O que não subir agora fica no rascunho e sobe no próximo login/foco.
        await useNotesStore.getState().flushPendingDrafts()
      } catch (err) {
        console.error('[close] Falha ao salvar antes de fechar — fechando mesmo assim:', err)
      } finally {
        // Garantia: o app SEMPRE fecha, mesmo que os saves acima falhem.
        window.electronAPI.closeApp()
      }
    })
  }, [])

  const content = isLoading ? (
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
  ) : isAuthenticated ? (
    <MainApp />
  ) : (
    <Login />
  )

  return (
    <>
      {content}
      {/* Banner de update mostrado SEMPRE — inclusive na tela de login. Se uma
          versão sair com backend/rede quebrada, o usuário não consegue logar; sem
          isto ele ficaria preso sem ver o botão de atualizar (catch-22). O card é
          fixed (canto inferior) e o update-store.init() já roda sem depender de login. */}
      <UpdateBanner />
    </>
  )
}
