import { useEffect, useState } from 'react'
import { Cloud, CloudOff, RefreshCw } from 'lucide-react'
import { useNotesStore } from '../../stores/notes-store'
import { useOpsStore } from '../../stores/ops-store'

/**
 * Indicador de nuvem (ao lado do sino). Mostra o estado de sincronização com o
 * Mileto Ops e permite forçar a sincronização ao clicar:
 *  - offline  → sem internet (alterações ficam salvas localmente).
 *  - pending  → há rascunhos locais pendentes / salvando.
 *  - synced   → online e sem pendências.
 */
export default function SyncStatus() {
  const pendingSync = useNotesStore((s) => s.pendingSync)
  const [online, setOnline] = useState(() => (typeof navigator !== 'undefined' ? navigator.onLine : true))
  const [syncing, setSyncing] = useState(false)

  useEffect(() => {
    const on = () => setOnline(true)
    const off = () => setOnline(false)
    window.addEventListener('online', on)
    window.addEventListener('offline', off)
    return () => {
      window.removeEventListener('online', on)
      window.removeEventListener('offline', off)
    }
  }, [])

  const state: 'offline' | 'pending' | 'synced' =
    !online ? 'offline' : syncing || pendingSync > 0 ? 'pending' : 'synced'

  const cfg = {
    offline: {
      Icon: CloudOff,
      color: '#f87171',
      title: 'Sem conexão — suas alterações estão salvas localmente e sobem quando a internet voltar',
    },
    pending: {
      Icon: RefreshCw,
      color: '#f59e0b',
      title: syncing
        ? 'Sincronizando com o Mileto Ops…'
        : `Falta sincronizar${pendingSync > 0 ? ` (${pendingSync})` : ''} — clique para sincronizar agora`,
    },
    synced: {
      Icon: Cloud,
      color: '#34d399',
      title: 'Sincronizado com o Mileto Ops — clique para forçar a sincronização',
    },
  }[state]
  const Icon = cfg.Icon

  const forceSync = async () => {
    if (syncing) return
    setSyncing(true)
    try {
      await useNotesStore.getState().flushPendingDrafts()
      await useOpsStore.getState().refreshOpsSnapshot('manual-sync')
      await useNotesStore.getState().loadNotes()
      await useNotesStore.getState().refreshPendingSync()
    } catch {
      // best-effort — o estado volta a refletir a realidade no próximo gatilho
    } finally {
      setSyncing(false)
    }
  }

  return (
    <button
      onClick={() => void forceSync()}
      className="titlebar-no-drag flex h-7 w-8 items-center justify-center rounded-md"
      style={{ color: cfg.color, transition: 'background-color 140ms' }}
      onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = '#232323' }}
      onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent' }}
      title={cfg.title}
    >
      <Icon
        size={15}
        className={syncing ? 'animate-spin' : undefined}
        style={syncing ? { animationDuration: '1s' } : undefined}
      />
    </button>
  )
}
