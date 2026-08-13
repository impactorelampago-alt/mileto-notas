import { useEffect, useState } from 'react'
import { AlertTriangle, Cloud, CloudOff, RefreshCw } from 'lucide-react'
import { useNotesStore } from '../../stores/notes-store'
import { useOpsStore } from '../../stores/ops-store'

/**
 * Indicador de sincronização com o Mileto Ops (ao lado do sino). Clicar força a
 * sincronização (e reconecta o tempo real). Quatro estados simples:
 *  - live    → ☁️ nuvem: tudo sincronizado.
 *  - pending → 🔄 duas setas girando: salvando / atualizando.
 *  - error   → ⚠️ categorias disponíveis, mas notas temporariamente desatualizadas.
 *  - offline → ☁️⃠ nuvem cortada: sem internet (alterações ficam salvas localmente).
 */
export default function SyncStatus() {
  const pendingSync = useNotesStore((s) => s.pendingSync)
  const realtimeStatus = useOpsStore((s) => s.realtimeStatus)
  const isOpsSyncing = useOpsStore((s) => s.isSyncing)
  const syncError = useOpsStore((s) => s.syncError)
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

  // A nuvem reflete TAMBÉM a saúde do tempo real: se o canal não está 'live', mostra
  // "reconectando" (âmbar) em vez de fingir que está tudo sincronizado (verde).
  const state: 'offline' | 'error' | 'pending' | 'live' =
    !online ? 'offline'
      : (syncing || isOpsSyncing) ? 'pending'
        : syncError ? 'error'
          : (pendingSync > 0 || realtimeStatus !== 'live') ? 'pending'
            : 'live'

  const cfg = {
    offline: {
      Icon: CloudOff,
      color: '#ef4444',
      spin: false,
      title: 'Sem conexão — suas alterações ficam salvas localmente e sobem quando a internet voltar',
    },
    error: {
      Icon: AlertTriangle,
      color: '#f59e0b',
      spin: false,
      title: `${syncError} Clique para tentar novamente agora.`,
    },
    pending: {
      Icon: RefreshCw,
      color: '#f59e0b',
      spin: true,
      title: syncing
        ? 'Atualizando com o Mileto Ops…'
        : pendingSync > 0
          ? `Falta sincronizar (${pendingSync}) — clique para sincronizar agora`
          : 'Reconectando o tempo real… — clique para forçar agora',
    },
    live: {
      Icon: Cloud,
      color: '#34d399',
      spin: false,
      title: 'Sincronizado com o Mileto Ops — clique para forçar a sincronização',
    },
  }[state]
  const Icon = cfg.Icon

  const forceSync = async () => {
    if (syncing) return
    setSyncing(true)
    try {
      // Reconecta o tempo real (se tiver caído) e força um ciclo completo de sync.
      if (useOpsStore.getState().realtimeStatus !== 'live') {
        useOpsStore.getState().subscribeToOpsChanges()
      }
      await useNotesStore.getState().flushPendingDrafts()
      const outcome = await useOpsStore.getState().refreshOpsSnapshot('manual-sync')
      // loadNotes recompõe parte da visão a partir das tasks. Só roda quando a
      // tentativa trouxe um snapshot completo e válido.
      if (outcome === 'complete') {
        await useNotesStore.getState().loadNotes()
      }
      await useNotesStore.getState().refreshPendingSync()
    } catch {
      // best-effort — o estado volta a refletir a realidade no próximo gatilho
    } finally {
      setSyncing(false)
    }
  }

  const errorBackground = 'rgba(245, 158, 11, 0.12)'

  return (
    <button
      onClick={() => void forceSync()}
      className={`titlebar-no-drag flex h-7 items-center justify-center rounded-md ${state === 'error' ? 'gap-1.5 px-2' : 'w-8'}`}
      style={{
        color: cfg.color,
        backgroundColor: state === 'error' ? errorBackground : 'transparent',
        transition: 'background-color 140ms',
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.backgroundColor = state === 'error'
          ? 'rgba(245, 158, 11, 0.2)'
          : '#232323'
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.backgroundColor = state === 'error' ? errorBackground : 'transparent'
      }}
      title={cfg.title}
      aria-label={state === 'error' ? 'Notas desatualizadas. Tentar novamente' : cfg.title}
    >
      <Icon
        size={15}
        className={cfg.spin ? 'animate-spin' : undefined}
        style={cfg.spin ? { animationDuration: '1s' } : undefined}
      />
      {state === 'error' && (
        <span className="whitespace-nowrap text-[10.5px] font-medium">
          Notas desatualizadas · tentar
        </span>
      )}
    </button>
  )
}
