import { create } from 'zustand'

/**
 * Estados do fluxo de atualização do app (electron-updater):
 *  - idle        → sem novidade (estado padrão).
 *  - checking    → verificação manual em andamento (usuário clicou).
 *  - uptodate    → verificação manual terminou e já está na última versão
 *                  (mostrado por alguns segundos e volta pra idle).
 *  - available   → existe versão nova pronta pra baixar/instalar.
 *  - downloading → baixando o pacote (com progresso).
 *  - installing  → baixou; vai reiniciar pra concluir.
 *  - error       → falhou (verificação/baixa) — clicar tenta de novo.
 */
export type UpdateStatus =
  | 'idle'
  | 'checking'
  | 'uptodate'
  | 'available'
  | 'downloading'
  | 'installing'
  | 'error'

interface UpdateState {
  status: UpdateStatus
  /** Versão NOVA disponível (quando houver). */
  version: string
  /** Versão instalada atualmente (pra tooltip / estado "atualizado"). */
  currentVersion: string
  percent: number
  errorMsg: string
  initialized: boolean
  /** Registra os listeners IPC UMA única vez e busca a versão instalada. */
  init: () => void
  /** Verificação manual (botão na titlebar). */
  check: () => void
  /** Baixa e instala a atualização disponível. */
  install: () => void
}

// Timer pra esconder o estado "atualizado" depois de alguns segundos.
let uptodateTimer: ReturnType<typeof setTimeout> | null = null
function clearUptodateTimer(): void {
  if (uptodateTimer) {
    clearTimeout(uptodateTimer)
    uptodateTimer = null
  }
}

// Rede de segurança: se 'checking'/'downloading' ficarem pendurados (rede que
// não responde nem rejeita — ex.: proxy/TCP em hang), destrava pra 'error' em
// vez de deixar o botão desabilitado e o card preso pra sempre. Em 'downloading'
// o timer é reiniciado a cada progresso, pra não matar download lento porém vivo.
let stuckTimer: ReturnType<typeof setTimeout> | null = null
const CHECK_TIMEOUT_MS = 45_000
const DOWNLOAD_TIMEOUT_MS = 90_000
const INSTALL_TIMEOUT_MS = 60_000
function clearStuckTimer(): void {
  if (stuckTimer) {
    clearTimeout(stuckTimer)
    stuckTimer = null
  }
}

export const useUpdateStore = create<UpdateState>((set, get) => {
  // Arma o timeout de travamento pro estado atual (checking/downloading).
  const armStuckTimer = (ms: number): void => {
    clearStuckTimer()
    stuckTimer = setTimeout(() => {
      set((s) => {
        if (s.status === 'checking')
          return { status: 'error', errorMsg: 'Tempo esgotado ao verificar — tente de novo' }
        if (s.status === 'downloading')
          return { status: 'error', errorMsg: 'Tempo esgotado ao baixar — tente de novo' }
        if (s.status === 'installing')
          return { status: 'error', errorMsg: 'Não foi possível instalar — feche e reabra o app para concluir' }
        return s
      })
    }, ms)
  }

  return {
    status: 'idle',
    version: '',
    currentVersion: '',
    percent: 0,
    errorMsg: '',
    initialized: false,

    init: () => {
      if (get().initialized) return
      const api = window.electronAPI?.updates
      if (!api) return
      set({ initialized: true })

      // Versão instalada (pra mostrar no tooltip e no estado "atualizado").
      window.electronAPI?.app
        ?.getVersion?.()
        .then((v) => set({ currentVersion: v ?? '' }))
        .catch(() => {})

      api.onAvailable((info) => {
        clearUptodateTimer()
        clearStuckTimer() // recebeu resposta da verificação
        set((s) => ({
          version: info?.version ?? '',
          // Não rebaixa estados mais avançados (já baixando/instalando).
          // Ao (re)entrar em 'available', zera resíduos de um ciclo anterior.
          ...(s.status === 'downloading' || s.status === 'installing'
            ? null
            : { status: 'available', percent: 0, errorMsg: '' }),
        }))
      })

      // "Sem atualização": só vira "atualizado" se foi uma verificação MANUAL
      // (status checking). A verificação silenciosa do início fica invisível.
      api.onNotAvailable?.(() => {
        clearStuckTimer()
        if (get().status !== 'checking') return // verificação silenciosa: invisível
        set({ status: 'uptodate' })
        clearUptodateTimer()
        uptodateTimer = setTimeout(() => {
          set((s) => (s.status === 'uptodate' ? { status: 'idle' } : s))
        }, 4000)
      })

      api.onProgress((info) => {
        // Progresso tardio depois de 'installing' é ignorado (não ressuscita o
        // download). Só reinicia o relógio de travamento se ainda está baixando.
        set((s) => (s.status === 'installing' ? s : { percent: info?.percent ?? 0, status: 'downloading' }))
        if (get().status === 'downloading') armStuckTimer(DOWNLOAD_TIMEOUT_MS)
      })

      api.onDownloaded(() => {
        set({ status: 'installing' })
        // Rede de segurança: se o quitAndInstall não reiniciar o app (instalador
        // barrado por AV/SmartScreen/permissão), destrava pra 'error' e reabilita
        // o botão. O autoInstallOnAppQuit (main) ainda conclui ao fechar/reabrir.
        armStuckTimer(INSTALL_TIMEOUT_MS)
      })

      // Só surface o erro se o usuário pediu algo (checking/downloading/installing).
      // Erro da verificação silenciosa em background (ex.: dev / sem release) é ignorado.
      api.onError((info) => {
        set((s) => {
          if (s.status === 'checking' || s.status === 'downloading' || s.status === 'installing') {
            clearStuckTimer()
            return { status: 'error', errorMsg: info?.message ?? 'Erro desconhecido' }
          }
          return s
        })
      })
    },

    check: () => {
      const api = window.electronAPI?.updates
      if (!api?.check) return
      clearUptodateTimer()
      // Zera version: um erro de verificação manual deve rotear o retry pra
      // check() (e não install()). Um erro durante download mantém version
      // (setada por onAvailable) e roteia pra install(), que é o correto.
      set({ status: 'checking', errorMsg: '', version: '' })
      armStuckTimer(CHECK_TIMEOUT_MS)
      api.check()
    },

    install: () => {
      clearUptodateTimer()
      set({ status: 'downloading', percent: 0, errorMsg: '' })
      armStuckTimer(DOWNLOAD_TIMEOUT_MS)
      window.electronAPI?.updates?.install()
    },
  }
})
