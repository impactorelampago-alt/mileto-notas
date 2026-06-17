import { useEffect, useState } from 'react'
import { Cloud, CloudOff, RefreshCw, WifiOff } from 'lucide-react'
import { useNotesStore } from '../../stores/notes-store'
import { useOpsStore } from '../../stores/ops-store'

/**
 * Indicador de nuvem / tempo real (ao lado do sino). Comunica o estado de
 * sincronização com o Mileto Ops e a saúde do tempo real, e permite forçar a
 * sincronização (e reconectar o tempo real) ao clicar:
 *  - offline        → sem internet: bloqueado (alterações ficam salvas localmente).
 *  - realtime-error → online, mas o canal de tempo real caiu: pode estar vendo
 *                     dados desatualizados — clique reconecta e sincroniza.
 *  - pending        → há rascunhos locais pendentes / salvando.
 *  - live           → online, sincronizado e recebendo atualizações ao vivo.
 */
export default function SyncStatus() {
  const pendingSync = useNotesStore((s) => s.pendingSync)
  const realtimeStatus = useOpsStore((s) => s.realtimeStatus)
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

  // Prioridade: sem internet > tempo real caiu > salvando > ao vivo.
  const state: 'offline' | 'realtime-error' | 'pending' | 'live' =
    !online ? 'offline'
      : syncing || pendingSync > 0 ? 'pending'
        : realtimeStatus === 'error' ? 'realtime-error'
          : 'live'

  const cfg = {
    offline: {
      Icon: WifiOff,
      color: '#ef4444',
      spin: false,
      pulse: false,
      title: 'Sem conexão — suas alterações estão salvas localmente e sobem quando a internet voltar',
    },
    'realtime-error': {
      Icon: CloudOff,
      color: '#f97316',
      spin: false,
      pulse: true,
      title: 'Tempo real indisponível — você pode estar vendo dados desatualizados. Clique para reconectar e sincronizar',
    },
    pending: {
      Icon: RefreshCw,
      color: '#f59e0b',
      spin: true,
      pulse: false,
      title: syncing
        ? 'Sincronizando com o Mileto Ops…'
        : `Falta sincronizar${pendingSync > 0 ? ` (${pendingSync})` : ''} — clique para sincronizar agora`,
    },
    live: {
      Icon: Cloud,
      color: '#34d399',
      spin: false,
      pulse: false,
      title: 'Sincronizado e ao vivo com o Mileto Ops — clique para forçar a sincronização',
    },
  }[state]
  const Icon = cfg.Icon

  const forceSync = async () => {
    if (syncing) return
    setSyncing(true)
    try {
      // Se o tempo real caiu, reconecta o canal antes de sincronizar (cobre o
      // estado "realtime-error" — clicar resolve).
      if (useOpsStore.getState().realtimeStatus !== 'live') {
        useOpsStore.getState().subscribeToOpsChanges()
      }
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
        className={cfg.spin ? 'animate-spin' : cfg.pulse ? 'animate-pulse' : undefined}
        style={cfg.spin ? { animationDuration: '1s' } : undefined}
      />
    </button>
  )
}
