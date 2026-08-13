import { useState, useRef, useEffect } from 'react'
import type { FormEvent } from 'react'
import { Mail, Lock, Eye, EyeOff, Minus, Maximize2, X, ShieldCheck, ArrowLeft, Copy, Check } from 'lucide-react'
import { useAuthStore } from '../stores/auth-store'
import Particles from '../components/ui/Particles'

export default function Login() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [mfaCode, setMfaCode] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isPending, setIsPending] = useState(false)
  const [showPassword, setShowPassword] = useState(false)
  const [secretCopied, setSecretCopied] = useState(false)

  const signIn = useAuthStore((state) => state.signIn)
  const startMfaEnrollment = useAuthStore((state) => state.startMfaEnrollment)
  const verifyMfa = useAuthStore((state) => state.verifyMfa)
  const cancelMfa = useAuthStore((state) => state.cancelMfa)
  const mfaRequired = useAuthStore((state) => state.mfaRequired)
  const mfaSetupRequired = useAuthStore((state) => state.mfaSetupRequired)
  const mfaEnrollment = useAuthStore((state) => state.mfaEnrollment)
  const authError = useAuthStore((state) => state.authError)
  const hasPendingSession = useAuthStore((state) => !!state.user && !state.isAuthenticated)
  const emailRef = useRef<HTMLInputElement>(null)
  const mfaCodeRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    emailRef.current?.focus()
  }, [])

  useEffect(() => {
    if (mfaRequired || mfaEnrollment) mfaCodeRef.current?.focus()
  }, [mfaRequired, mfaEnrollment])

  const securityStep = mfaRequired || mfaSetupRequired

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    if (isPending) return
    setError(null)

    if (!email.trim() || !password.trim()) {
      setError('Preencha o email e a senha.')
      return
    }

    setIsPending(true)
    const result = await signIn(email.trim(), password)
    setIsPending(false)

    if (result.mfaRequired) {
      setPassword('')
      setMfaCode('')
    }
    if (result.error) setError(result.error)
  }

  const handleMfaSubmit = async (e: FormEvent) => {
    e.preventDefault()
    if (isPending) return
    setError(null)

    if (!/^\d{6}$/.test(mfaCode)) {
      setError('Digite os 6 dígitos do aplicativo autenticador.')
      return
    }

    setIsPending(true)
    const result = await verifyMfa(mfaCode)
    setIsPending(false)

    if (result.error) {
      setError(result.error)
      setMfaCode('')
      requestAnimationFrame(() => mfaCodeRef.current?.focus())
    }
  }

  const handleStartEnrollment = async (e: FormEvent) => {
    e.preventDefault()
    if (isPending) return
    setError(null)
    setIsPending(true)
    const result = await startMfaEnrollment()
    setIsPending(false)
    if (result.error) setError(result.error)
  }

  const handleCancelMfa = async () => {
    if (isPending) return
    setIsPending(true)
    setError(null)
    await cancelMfa()
    setMfaCode('')
    setPassword('')
    setSecretCopied(false)
    setIsPending(false)
    requestAnimationFrame(() => emailRef.current?.focus())
  }

  const displayedError = error ?? authError

  return (
    <div
      className="flex h-screen items-center justify-center"
      style={{
        background:
          'radial-gradient(ellipse at 50% 0%, rgba(16, 185, 129, 0.08) 0%, transparent 50%), #09090b',
      }}
    >
      <Particles />

      {/* Controles da janela */}
      <div
        className="titlebar-drag fixed left-0 right-0 top-0 flex h-9 items-center justify-end"
        style={{ zIndex: 50 }}
      >
        <div className="titlebar-no-drag flex items-center">
          <button
            onClick={() => window.electronAPI.window.minimize()}
            className="flex h-9 w-[46px] items-center justify-center text-zinc-500 transition-colors duration-150 hover:bg-zinc-800 hover:text-zinc-300"
            title="Minimizar"
          >
            <Minus size={16} />
          </button>
          <button
            onClick={() => window.electronAPI.window.maximize()}
            className="flex h-9 w-[46px] items-center justify-center text-zinc-500 transition-colors duration-150 hover:bg-zinc-800 hover:text-zinc-300"
            title="Maximizar"
          >
            <Maximize2 size={16} />
          </button>
          <button
            onClick={() => window.electronAPI.window.close()}
            className="flex h-9 w-[46px] items-center justify-center text-zinc-500 transition-colors duration-150 hover:bg-[#e81123] hover:text-white"
            title="Fechar"
          >
            <X size={16} />
          </button>
        </div>
      </div>

      {/* Card de login */}
      <div
        className="relative z-10 w-full max-w-[420px] rounded-xl backdrop-blur-xl"
        style={{
          backgroundColor: 'rgba(24, 24, 27, 0.85)',
          border: 'none',
          borderRadius: '12px',
          padding: '52px 48px',
          maxWidth: securityStep ? 480 : 420,
          maxHeight: 'calc(100vh - 64px)',
          overflowY: 'auto',
          boxShadow:
            '0 0 0 1.5px rgba(16, 185, 129, 0.3), 0 0 16px rgba(16, 185, 129, 0.1), 0 8px 32px rgba(0, 0, 0, 0.5), 0 4px 16px rgba(16, 185, 129, 0.08)',
        }}
      >
        {/* Cabeçalho */}
        <div className="mb-10 flex flex-col items-center gap-4">
          <img
            src="./logo.png"
            alt="Mileto Notas"
            style={{ width: 80, height: 80, objectFit: 'contain', filter: 'drop-shadow(0 6px 22px rgba(16,185,129,0.3))' }}
          />
          <div className="text-center">
            <h1
              className="font-semibold text-zinc-100"
              style={{ fontSize: '24px' }}
            >
              {mfaSetupRequired ? 'Proteja sua conta' : mfaRequired ? 'Verificação em duas etapas' : 'Ops Notas'}
            </h1>
            <p className="mt-1 text-zinc-500" style={{ fontSize: '14px' }}>
              {mfaSetupRequired
                ? (mfaEnrollment ? 'Escaneie o QR Code e confirme' : 'Configure a verificação em duas etapas')
                : mfaRequired ? 'Digite o código de 6 dígitos' : 'Entre com sua conta'}
            </p>
            <p className="mt-1 text-zinc-600" style={{ fontSize: '13px' }}>
              {securityStep
                ? (mfaSetupRequired
                    ? 'Obrigatório para proteger o acesso da equipe'
                    : 'Use o código atual do seu aplicativo autenticador')
                : 'Bloco de notas colaborativo da sua equipe'}
            </p>
          </div>
        </div>

        {/* Formulário */}
        <form
          onSubmit={mfaSetupRequired && !mfaEnrollment
            ? handleStartEnrollment
            : securityStep ? handleMfaSubmit : handleSubmit}
          noValidate
        >
          {securityStep ? (
            <div style={{ marginBottom: '40px' }}>
              {mfaSetupRequired && !mfaEnrollment && (
                <div
                  className="mb-5 rounded-lg text-zinc-400"
                  style={{
                    padding: '14px 16px',
                    backgroundColor: 'rgba(16,185,129,0.08)',
                    border: '1px solid rgba(16,185,129,0.22)',
                    fontSize: '13px',
                    lineHeight: 1.55,
                  }}
                >
                  Use o Google Authenticator, Microsoft Authenticator, 1Password ou Authy.
                  O QR Code será mostrado somente durante este cadastro.
                </div>
              )}

              {mfaSetupRequired && mfaEnrollment && (
                <div className="mb-5 flex flex-col items-center gap-3">
                  <div
                    className="rounded-xl bg-white"
                    style={{ padding: 10, boxShadow: '0 0 0 1px rgba(16,185,129,0.28)' }}
                  >
                    <img
                      src={mfaEnrollment.qrCode}
                      alt="QR Code para cadastrar o aplicativo autenticador"
                      style={{ width: 176, height: 176, display: 'block' }}
                    />
                  </div>
                  <div className="w-full">
                    <p className="mb-1.5 text-zinc-500" style={{ fontSize: '12px' }}>
                      Não consegue escanear? Use esta chave manual:
                    </p>
                    <div
                      className="flex items-center gap-2 rounded-lg"
                      style={{ padding: '8px 10px', backgroundColor: '#27272a', border: '1px solid #3f3f46' }}
                    >
                      <code className="min-w-0 flex-1 break-all text-emerald-300" style={{ fontSize: '12px', letterSpacing: '0.08em' }}>
                        {mfaEnrollment.secret}
                      </code>
                      <button
                        type="button"
                        onClick={() => {
                          void navigator.clipboard.writeText(mfaEnrollment.secret).then(() => {
                            setSecretCopied(true)
                            window.setTimeout(() => setSecretCopied(false), 1600)
                          }).catch(() => setError('Não foi possível copiar. Selecione a chave manualmente.'))
                        }}
                        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-zinc-400 transition-colors hover:bg-zinc-700 hover:text-emerald-300"
                        aria-label="Copiar chave manual"
                        title="Copiar chave manual"
                      >
                        {secretCopied ? <Check size={15} /> : <Copy size={15} />}
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {(mfaRequired || mfaEnrollment) && (
                <>
              <label
                htmlFor="mfa-code"
                className="mb-1.5 block font-medium text-zinc-400"
                style={{ fontSize: '13px' }}
              >
                Código de verificação
              </label>
              <div className="relative">
                <ShieldCheck
                  size={17}
                  className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-emerald-500"
                />
                <input
                  ref={mfaCodeRef}
                  id="mfa-code"
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  autoComplete="one-time-code"
                  value={mfaCode}
                  onChange={(e) => {
                    setMfaCode(e.target.value.replace(/\D/g, '').slice(0, 6))
                    setError(null)
                  }}
                  disabled={isPending}
                  placeholder="000000"
                  aria-describedby="mfa-code-help"
                  className="w-full outline-none transition-colors duration-150 focus:border-emerald-500 disabled:opacity-50 placeholder:text-zinc-600 text-zinc-100"
                  style={{
                    backgroundColor: '#27272a',
                    border: '1px solid #3f3f46',
                    borderRadius: '8px',
                    padding: '12px 40px',
                    fontSize: '20px',
                    fontVariantNumeric: 'tabular-nums',
                    letterSpacing: '0.35em',
                    textAlign: 'center',
                    width: '100%',
                  }}
                />
              </div>
              <p id="mfa-code-help" className="mt-2 text-zinc-600" style={{ fontSize: '12px' }}>
                {mfaSetupRequired
                  ? 'Depois de escanear, digite o código atual para ativar e entrar.'
                  : 'O código muda a cada 30 segundos.'}
              </p>
                </>
              )}
            </div>
          ) : (
            <>
          {/* Email */}
          <div className="mb-4">
            <label
              htmlFor="email"
              className="mb-1.5 block font-medium text-zinc-400"
              style={{ fontSize: '13px' }}
            >
              Email
            </label>
            <div className="relative">
              <Mail
                size={16}
                className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500"
              />
              <input
                ref={emailRef}
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={isPending}
                autoComplete="email"
                placeholder="seu@email.com"
                className="w-full outline-none transition-colors duration-150 focus:border-emerald-500 disabled:opacity-50 placeholder:text-zinc-600 text-zinc-100"
                style={{
                  backgroundColor: '#27272a',
                  border: '1px solid #3f3f46',
                  borderRadius: '8px',
                  padding: '12px 12px 12px 40px',
                  fontSize: '15px',
                  width: '100%',
                }}
              />
            </div>
          </div>

          {/* Senha */}
          <div style={{ marginBottom: '40px' }}>
            <label
              htmlFor="password"
              className="mb-1.5 block font-medium text-zinc-400"
              style={{ fontSize: '13px' }}
            >
              Senha
            </label>
            <div className="relative">
              <Lock
                size={16}
                className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500"
              />
              <input
                id="password"
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={isPending}
                autoComplete="current-password"
                placeholder="••••••••"
                className="w-full outline-none transition-colors duration-150 focus:border-emerald-500 disabled:opacity-50 placeholder:text-zinc-600 text-zinc-100"
                style={{
                  backgroundColor: '#27272a',
                  border: '1px solid #3f3f46',
                  borderRadius: '8px',
                  padding: '12px 42px 12px 40px',
                  fontSize: '15px',
                  width: '100%',
                }}
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                disabled={isPending}
                tabIndex={-1}
                aria-label={showPassword ? 'Ocultar senha' : 'Mostrar senha'}
                title={showPassword ? 'Ocultar senha' : 'Mostrar senha'}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-500 transition-colors duration-150 hover:text-zinc-300 disabled:opacity-50"
              >
                {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </div>
            </>
          )}

          {/* Mensagem de erro */}
          {displayedError && (
            <p className="mb-4 text-red-400" style={{ fontSize: '13px' }}>
              {displayedError}
            </p>
          )}

          {/* Botão */}
          <button
            type="submit"
            disabled={isPending || ((mfaRequired || !!mfaEnrollment) && mfaCode.length !== 6)}
            className="flex w-full items-center justify-center rounded-lg font-medium text-white transition-all duration-150 hover:bg-emerald-500 hover:scale-[1.01] active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-60 disabled:scale-100"
            style={{
              height: '44px',
              backgroundColor: isPending ? '#059669' : '#10b981',
              fontSize: '15px',
              boxShadow: isPending ? 'none' : '0 4px 24px rgba(16,185,129,0.2)',
            }}
          >
            {isPending
              ? (securityStep ? (mfaEnrollment ? 'Ativando...' : mfaRequired ? 'Verificando...' : 'Gerando...') : 'Entrando...')
              : (mfaSetupRequired
                  ? (mfaEnrollment ? 'Ativar e continuar' : 'Gerar QR Code')
                  : mfaRequired ? 'Confirmar código' : 'Entrar')}
          </button>

          {(securityStep || hasPendingSession) && (
            <button
              type="button"
              onClick={handleCancelMfa}
              disabled={isPending}
              className="mt-3 flex w-full items-center justify-center gap-2 rounded-lg text-zinc-500 transition-colors duration-150 hover:bg-zinc-800 hover:text-zinc-300 disabled:cursor-not-allowed disabled:opacity-50"
              style={{ height: '40px', fontSize: '13px' }}
            >
              <ArrowLeft size={15} />
              {securityStep ? 'Voltar para o login' : 'Sair desta conta'}
            </button>
          )}
        </form>

        {/* Rodapé */}
        <p className="mt-6 text-center text-zinc-600" style={{ fontSize: '11px' }}>
          Mileto Ops © 2026
        </p>
      </div>
    </div>
  )
}
