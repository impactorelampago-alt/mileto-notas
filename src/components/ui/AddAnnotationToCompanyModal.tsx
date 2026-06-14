import { useEffect, useState } from 'react'
import { Building2, Check, X } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuthStore } from '../../stores/auth-store'

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string

async function restGet<T>(path: string): Promise<T[]> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 6000)
  try {
    const { data: session } = await supabase.auth.getSession()
    const token = session.session?.access_token ?? SUPABASE_KEY
    const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
      headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${token}` },
      signal: controller.signal,
      cache: 'no-store',
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return await res.json() as T[]
  } finally {
    clearTimeout(timeout)
  }
}

async function restPatch(table: string, filter: string, body: Record<string, unknown>): Promise<void> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 6000)
  try {
    const { data: session } = await supabase.auth.getSession()
    const token = session.session?.access_token ?? SUPABASE_KEY
    const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${filter}`, {
      method: 'PATCH',
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        Prefer: 'return=minimal',
      },
      body: JSON.stringify(body),
      signal: controller.signal,
      cache: 'no-store',
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
  } finally {
    clearTimeout(timeout)
  }
}

interface OpsClient { id: string; company: string }

interface AddAnnotationToCompanyModalProps {
  visible: boolean
  excerpt: string
  noteId: string
  noteTitle?: string
  selectionStart: number
  selectionEnd: number
  initialClientId: string | null
  onClose: () => void
  onSaved?: () => void
}

export default function AddAnnotationToCompanyModal({
  visible,
  excerpt,
  initialClientId,
  onClose,
  onSaved,
}: AddAnnotationToCompanyModalProps) {
  const [clients, setClients] = useState<OpsClient[]>([])
  const [search, setSearch] = useState('')
  const [selectedClientId, setSelectedClientId] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const userId = useAuthStore((s) => s.user?.id)

  useEffect(() => {
    if (!visible || !userId) return

    setSelectedClientId(initialClientId)
    setSearch('')
    setSaveError(null)
    setIsLoading(true)

    void restGet<OpsClient>(
      `clients?select=id,company&or=(assigned_to_id.eq.${userId},created_by_id.eq.${userId})&order=company.asc`,
    )
      .then((data) => { setClients(data); setIsLoading(false) })
      .catch((err) => {
        console.error('[annotations] load clients:', err)
        setIsLoading(false)
      })
  }, [visible, initialClientId, userId])

  useEffect(() => {
    if (!visible) return
    const handleKeyDown = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [visible, onClose])

  if (!visible) return null

  const selectedClient = clients.find((c) => c.id === selectedClientId) ?? null
  const filteredClients = clients.filter(
    (c) => c.id !== selectedClientId && (!search || c.company.toLowerCase().includes(search.toLowerCase())),
  )

  const handleSave = async () => {
    if (!selectedClientId || !userId || isSaving) return
    setIsSaving(true)
    setSaveError(null)

    try {
      // Busca observações atuais
      const rows = await restGet<{ notes: string | null }>(
        `clients?select=notes&id=eq.${selectedClientId}`,
      )
      const existing = rows[0]?.notes ?? ''
      const updated = existing ? `${existing}\n${excerpt}` : excerpt

      // Atualiza o campo notes da empresa
      await restPatch('clients', `id=eq.${selectedClientId}`, { notes: updated })

      onSaved?.()
      onClose()
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Erro desconhecido'
      console.error('[annotations] save:', msg)
      setSaveError(msg)
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ backgroundColor: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)' }}
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div style={{
        width: '100%', maxWidth: '520px', backgroundColor: '#1e1e1e',
        borderRadius: '12px', border: '1px solid #3d3d3d', boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
      }}>
        <div className="flex items-center justify-between" style={{ padding: '16px 20px', borderBottom: '1px solid #3d3d3d' }}>
          <span style={{ fontSize: '15px', fontWeight: 600, color: '#cccccc' }}>Adicionar trecho à empresa</span>
          <button onClick={onClose} className="flex h-7 w-7 items-center justify-center rounded" style={{ color: '#6d6d6d' }}>
            <X size={16} />
          </button>
        </div>

        <div style={{ padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
          {/* Trecho */}
          <div style={{
            backgroundColor: '#252526', border: '1px solid #3d3d3d', borderRadius: '8px',
            padding: '10px 12px', color: '#d4d4d8', fontSize: '13px', lineHeight: 1.5,
            whiteSpace: 'pre-wrap', maxHeight: '80px', overflowY: 'auto',
          }}>
            {excerpt}
          </div>

          {/* Empresa selecionada OU busca */}
          {selectedClient ? (
            <div className="flex items-center gap-2 rounded-lg px-3" style={{
              backgroundColor: '#1a2f25', border: '1px solid #10b981', height: '36px',
            }}>
              <Building2 size={14} style={{ color: '#10b981', flexShrink: 0 }} />
              <span style={{ flex: 1, fontSize: '13px', color: '#34d399', fontWeight: 500 }}>{selectedClient.company}</span>
              <button onClick={() => setSelectedClientId(null)} className="flex items-center justify-center rounded" style={{ color: '#6d6d6d' }} title="Trocar">
                <X size={13} />
              </button>
            </div>
          ) : (
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar empresa..."
              className="w-full outline-none"
              style={{
                backgroundColor: '#252526', border: '1px solid #3d3d3d', borderRadius: '8px',
                height: '36px', color: '#cccccc', fontSize: '13px', padding: '0 12px',
              }}
            />
          )}

          {/* Lista */}
          <div style={{ maxHeight: '200px', overflowY: 'auto' }}>
            {isLoading ? (
              <p style={{ color: '#6d6d6d', fontSize: '13px', textAlign: 'center', padding: '16px 0' }}>Carregando...</p>
            ) : filteredClients.length === 0 ? (
              <p style={{ color: '#6d6d6d', fontSize: '13px', textAlign: 'center', padding: '16px 0' }}>
                {clients.length === 0 ? 'Nenhuma empresa encontrada' : 'Sem outros resultados'}
              </p>
            ) : filteredClients.map((c) => (
              <button
                key={c.id}
                onClick={() => { setSelectedClientId(c.id); setSearch('') }}
                className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left transition-colors hover:bg-zinc-800"
                style={{ color: '#cccccc' }}
              >
                <Building2 size={14} style={{ color: '#6d6d6d', flexShrink: 0 }} />
                <span className="flex-1 text-[13px]">{c.company}</span>
              </button>
            ))}
          </div>

          {saveError && <p style={{ color: '#f87171', fontSize: '12px' }}>Erro: {saveError}</p>}
        </div>

        <div className="flex justify-end gap-2" style={{ padding: '12px 20px', borderTop: '1px solid #3d3d3d' }}>
          <button onClick={onClose} className="rounded-lg" style={{ height: '34px', padding: '0 16px', backgroundColor: '#333333', color: '#cccccc', fontSize: '13px' }}>
            Cancelar
          </button>
          <button
            onClick={() => void handleSave()}
            disabled={!selectedClientId || isSaving}
            className="flex items-center gap-2 rounded-lg transition-colors disabled:opacity-40"
            style={{ height: '34px', padding: '0 16px', backgroundColor: '#059669', color: '#ffffff', fontSize: '13px' }}
          >
            {isSaving ? 'Salvando...' : <><Check size={13} /> Salvar anotação</>}
          </button>
        </div>
      </div>
    </div>
  )
}
