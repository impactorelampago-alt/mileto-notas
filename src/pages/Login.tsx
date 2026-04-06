import { useState, useRef, useEffect } from 'react'
import type { FormEvent } from 'react'
import { NotebookPen, Mail, Lock, Minus, Maximize2, X } from 'lucide-react'
import { useAuthStore } from '../stores/auth-store'
import Particles from '../components/ui/Particles'

export default function Login() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isPending, setIsPending] = useState(false)

  const signIn = useAuthStore((state) => state.signIn)
  const emailRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    emailRef.current?.focus()
  }, [])

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

    if (result.error) {
      setError(result.error)
    }
  }

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
          boxShadow:
            '0 0 0 1.5px rgba(16, 185, 129, 0.3), 0 0 16px rgba(16, 185, 129, 0.1), 0 8px 32px rgba(0, 0, 0, 0.5), 0 4px 16px rgba(16, 185, 129, 0.08)',
        }}
      >
        {/* Cabeçalho */}
        <div className="mb-10 flex flex-col items-center gap-4">
          <div
            className="flex h-16 w-16 items-center justify-center rounded-full"
            style={{ backgroundColor: 'rgba(16, 185, 129, 0.1)' }}
          >
            <NotebookPen size={40} className="text-emerald-500" />
          </div>
          <div className="text-center">
            <h1
              className="font-semibold text-zinc-100"
              style={{ fontSize: '24px' }}
            >
              Ops Notas
            </h1>
            <p className="mt-1 text-zinc-500" style={{ fontSize: '14px' }}>
              Entre com sua conta
            </p>
            <p className="mt-1 text-zinc-600" style={{ fontSize: '13px' }}>
              Bloco de notas colaborativo da sua equipe
            </p>
          </div>
        </div>

        {/* Formulário */}
        <form onSubmit={handleSubmit} noValidate>
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
                type="password"
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
                  padding: '12px 12px 12px 40px',
                  fontSize: '15px',
                  width: '100%',
                }}
              />
            </div>
          </div>

          {/* Mensagem de erro */}
          {error && (
            <p className="mb-4 text-red-400" style={{ fontSize: '13px' }}>
              {error}
            </p>
          )}

          {/* Botão */}
          <button
            type="submit"
            disabled={isPending}
            className="flex w-full items-center justify-center rounded-lg font-medium text-white transition-all duration-150 hover:bg-emerald-500 hover:scale-[1.01] active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-60 disabled:scale-100"
            style={{
              height: '44px',
              backgroundColor: isPending ? '#059669' : '#10b981',
              fontSize: '15px',
              boxShadow: isPending ? 'none' : '0 4px 24px rgba(16,185,129,0.2)',
            }}
          >
            {isPending ? 'Entrando...' : 'Entrar'}
          </button>
        </form>

        {/* Rodapé */}
        <p className="mt-6 text-center text-zinc-600" style={{ fontSize: '11px' }}>
          Mileto Ops © 2026
        </p>
      </div>
    </div>
  )
}
