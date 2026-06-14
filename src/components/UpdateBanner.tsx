import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { Download, Loader2, RefreshCw, AlertTriangle } from 'lucide-react'

type Status = 'idle' | 'available' | 'downloading' | 'installing' | 'error'

/**
 * Notificação de atualização DENTRO do Mileto Notas. Aparece (e fica) quando há
 * versão nova; o botão "Instalar atualização" baixa (com progresso) e instala/
 * reinicia o app. Persistente até o usuário atualizar.
 */
export default function UpdateBanner() {
  const [status, setStatus] = useState<Status>('idle')
  const [version, setVersion] = useState('')
  const [percent, setPercent] = useState(0)
  const [errorMsg, setErrorMsg] = useState('')

  useEffect(() => {
    const api = window.electronAPI?.updates
    if (!api) return
    api.onAvailable((info) => {
      setVersion(info?.version ?? '')
      setStatus((s) => (s === 'downloading' || s === 'installing' ? s : 'available'))
    })
    api.onProgress((info) => {
      setPercent(info?.percent ?? 0)
      setStatus((s) => (s === 'installing' ? s : 'downloading'))
    })
    api.onDownloaded(() => setStatus('installing'))
    api.onError((info) => {
      setErrorMsg(info?.message ?? 'Erro desconhecido')
      setStatus('error')
    })
  }, [])

  const startInstall = () => {
    setPercent(0)
    setStatus('downloading')
    window.electronAPI?.updates?.install()
  }

  if (status === 'idle') return null

  const title =
    status === 'error' ? 'Falha na atualização'
      : status === 'installing' ? 'Instalando atualização…'
        : status === 'downloading' ? 'Baixando atualização…'
          : 'Atualização disponível'

  const subtitle =
    status === 'error' ? errorMsg
      : status === 'installing' ? 'O app vai reiniciar para concluir.'
        : status === 'downloading' ? `${percent}% concluído`
          : `${version ? 'Versão ' + version + ' ' : ''}pronta. Baixe e instale com um clique.`

  return (
    <motion.div
      initial={{ opacity: 0, y: 24, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ type: 'spring', stiffness: 320, damping: 30 }}
      className="fixed z-[200]"
      style={{ right: 18, bottom: 18, width: 322 }}
    >
      <div style={{ borderRadius: 14, overflow: 'hidden', backgroundColor: '#1e1e1e', border: '1px solid #2f2f2f', boxShadow: '0 16px 44px rgba(0,0,0,0.5)' }}>
        <div style={{ height: 3, background: 'linear-gradient(90deg,#10b981,#34d399)' }} />
        <div style={{ padding: 16 }}>
          <div className="flex items-start gap-3">
            <div
              className="flex shrink-0 items-center justify-center"
              style={{ width: 36, height: 36, borderRadius: 10, backgroundColor: status === 'error' ? 'rgba(245,158,11,0.14)' : 'rgba(16,185,129,0.14)', border: `1px solid ${status === 'error' ? 'rgba(245,158,11,0.4)' : 'rgba(52,211,153,0.35)'}` }}
            >
              {status === 'error'
                ? <AlertTriangle size={18} style={{ color: '#f59e0b' }} />
                : status === 'installing'
                  ? <Loader2 size={18} className="animate-spin" style={{ color: '#34d399' }} />
                  : <Download size={18} style={{ color: '#34d399' }} />}
            </div>
            <div className="min-w-0 flex-1">
              <div style={{ color: '#f4f4f5', fontSize: 13.5, fontWeight: 600 }}>{title}</div>
              <div className="break-words" style={{ color: '#9a9aa3', fontSize: 12, marginTop: 2, lineHeight: 1.4 }}>{subtitle}</div>
            </div>
          </div>

          {status === 'downloading' && (
            <div style={{ marginTop: 12, height: 6, borderRadius: 999, backgroundColor: '#2a2a2a', overflow: 'hidden' }}>
              <div style={{ height: '100%', width: `${percent}%`, background: 'linear-gradient(90deg,#10b981,#34d399)', transition: 'width 200ms' }} />
            </div>
          )}

          {(status === 'available' || status === 'error') && (
            <button
              onClick={startInstall}
              className="mt-3 flex w-full items-center justify-center gap-2 rounded-lg transition-colors"
              style={{ height: 38, backgroundColor: '#10b981', color: '#04140e', fontSize: 13, fontWeight: 700 }}
              onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = '#0ea372' }}
              onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = '#10b981' }}
            >
              {status === 'error' ? <RefreshCw size={15} /> : <Download size={15} />}
              {status === 'error' ? 'Tentar de novo' : 'Instalar atualização'}
            </button>
          )}
        </div>
      </div>
    </motion.div>
  )
}
