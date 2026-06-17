import { DownloadCloud, Loader2, CheckCircle2, AlertTriangle } from 'lucide-react'
import { useUpdateStore } from '../../stores/update-store'

/**
 * Botão de atualização na titlebar (ao lado do sino e do indicador de nuvem).
 * Sempre visível, discreto quando não há novidade:
 *  - idle      → clique verifica se há atualização.
 *  - checking  → verificando (spinner).
 *  - uptodate  → "você está atualizado" (some sozinho em ~4s).
 *  - available → fica VERDE + pulsando, com ponto; clique instala.
 *  - downloading/installing → spinner (mostra % no tooltip).
 *  - error     → âmbar; clique tenta de novo.
 * Compartilha o estado com o UpdateBanner via [update-store] — um único
 * registrador de eventos IPC, sem listeners se atropelando.
 */
export default function UpdateButton() {
  const status = useUpdateStore((s) => s.status)
  const version = useUpdateStore((s) => s.version)
  const currentVersion = useUpdateStore((s) => s.currentVersion)
  const percent = useUpdateStore((s) => s.percent)
  const errorMsg = useUpdateStore((s) => s.errorMsg)
  const check = useUpdateStore((s) => s.check)
  const install = useUpdateStore((s) => s.install)

  const busy = status === 'checking' || status === 'downloading' || status === 'installing'

  const handleClick = () => {
    switch (status) {
      case 'available':
        return install()
      case 'error':
        // Se já sabemos a versão nova, tenta instalar; senão, verifica de novo.
        return version ? install() : check()
      case 'idle':
      case 'uptodate':
        return check()
      default:
        return // checking / downloading / installing → sem ação
    }
  }

  const ver = currentVersion ? ` v${currentVersion}` : ''
  const cfg = {
    idle: {
      color: '#969696',
      title: `Mileto Notas${ver} — clique para verificar atualizações`,
    },
    checking: { color: '#969696', title: 'Verificando atualizações…' },
    uptodate: { color: '#34d399', title: `Você está atualizado${ver ? ' (' + ver.trim() + ')' : ''}` },
    available: {
      color: '#34d399',
      title: `Atualização disponível${version ? ' (v' + version + ')' : ''} — clique para instalar`,
    },
    downloading: { color: '#34d399', title: `Baixando atualização… ${percent}%` },
    installing: { color: '#34d399', title: 'Instalando atualização… o app vai reiniciar' },
    error: { color: '#f59e0b', title: `Falha na atualização${errorMsg ? ': ' + errorMsg : ''} — clique para tentar de novo` },
  }[status]

  const renderIcon = () => {
    if (status === 'checking' || status === 'downloading' || status === 'installing') {
      return <Loader2 size={15} className="animate-spin" style={{ animationDuration: '1s' }} />
    }
    if (status === 'uptodate') return <CheckCircle2 size={15} />
    if (status === 'error') return <AlertTriangle size={15} />
    return <DownloadCloud size={15} className={status === 'available' ? 'animate-pulse' : undefined} />
  }

  return (
    <button
      onClick={handleClick}
      disabled={busy}
      className="titlebar-no-drag relative flex h-7 w-9 items-center justify-center rounded-md"
      style={{
        color: cfg.color,
        cursor: busy ? 'default' : 'pointer',
        transition: 'background-color 140ms, color 140ms',
      }}
      onMouseEnter={(e) => { if (!busy) e.currentTarget.style.backgroundColor = '#232323' }}
      onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent' }}
      title={cfg.title}
    >
      {renderIcon()}
      {status === 'available' && (
        <span
          className="absolute"
          style={{
            top: 4, right: 6, width: 7, height: 7, borderRadius: 999,
            backgroundColor: '#10b981', border: '1.5px solid #1a1a1a',
          }}
        />
      )}
    </button>
  )
}
