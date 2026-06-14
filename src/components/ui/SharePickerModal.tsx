import { useState, useEffect, useMemo } from 'react'
import { X, Check, Users, Search, Eye, Pencil } from 'lucide-react'
import { useAuthStore } from '../../stores/auth-store'
import { useSharingStore } from '../../stores/sharing-store'
import type { UserRole, NotePermission } from '../../lib/types'

const ROLE_LABELS: Partial<Record<UserRole, string>> = {
  DONO: 'Dono', GERENTE: 'Gerente', COORDENADOR: 'Coordenador', FUNCIONARIO: 'Funcionário', GUEST: 'Convidado',
  GESTOR_TRAFEGO: 'Gestor de Tráfego', VENDEDOR: 'Vendedor', FINANCEIRO: 'Financeiro',
}

interface Props {
  kind: 'category' | 'note'
  id: string
  label: string
  onClose: () => void
}

export default function SharePickerModal({ kind, id, label, onClose }: Props) {
  const user = useAuthStore((s) => s.user)
  const teamProfiles = useAuthStore((s) => s.teamProfiles)
  const categoryShares = useSharingStore((s) => s.categoryShares)
  const noteShares = useSharingStore((s) => s.noteShares)
  const setCategoryShare = useSharingStore((s) => s.setCategoryShare)
  const setNoteShare = useSharingStore((s) => s.setNoteShare)

  const current = kind === 'category' ? categoryShares[id] ?? [] : noteShares[id] ?? []
  const [selected, setSelected] = useState<Set<string>>(() => new Set(current))
  const [query, setQuery] = useState('')
  // Permissão escolhida ao compartilhar uma NOTA (categoria é sempre EDIT por ora).
  const [permission, setPermission] = useState<NotePermission>('EDIT')

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const others = useMemo(() => teamProfiles.filter((p) => p.id !== user?.id), [teamProfiles, user?.id])
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return others
    return others.filter((p) => (p.name ?? p.email).toLowerCase().includes(q))
  }, [others, query])

  const toggle = (uid: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(uid)) next.delete(uid)
      else next.add(uid)
      return next
    })
  }

  const handleConfirm = async () => {
    const ids = Array.from(selected)
    if (kind === 'category') await setCategoryShare(id, ids)
    else await setNoteShare(id, ids, permission)
    onClose()
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ backgroundColor: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)' }}
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div style={{ width: '100%', maxWidth: 440, backgroundColor: '#202020', border: '1px solid #353535', borderRadius: 14, boxShadow: '0 24px 60px rgba(0,0,0,0.6)', overflow: 'hidden' }}>
        <div className="flex items-center justify-between" style={{ padding: '16px 18px', borderBottom: '1px solid #2a2a2a' }}>
          <div className="flex min-w-0 items-center gap-2.5">
            <span className="flex items-center justify-center" style={{ width: 30, height: 30, borderRadius: 8, backgroundColor: 'rgba(16,185,129,0.14)', color: '#34d399', flexShrink: 0 }}>
              <Users size={16} />
            </span>
            <div className="min-w-0">
              <div style={{ fontSize: 14, fontWeight: 600, color: '#e7e7ea' }}>Compartilhar</div>
              <div className="truncate" style={{ fontSize: 12, color: '#8a8a92' }}>
                {kind === 'category' ? 'Categoria' : 'Nota'}: {label || 'Sem título'}
              </div>
            </div>
          </div>
          <button
            onClick={onClose}
            className="flex items-center justify-center rounded"
            style={{ width: 28, height: 28, color: '#8a8a92' }}
            onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = '#2a2a2a'; e.currentTarget.style.color = '#e4e4e7' }}
            onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; e.currentTarget.style.color = '#8a8a92' }}
          >
            <X size={16} />
          </button>
        </div>

        <div className="flex items-center gap-2 px-4 py-2.5" style={{ borderBottom: '1px solid #2a2a2a' }}>
          <Search size={14} style={{ color: '#6d6d75' }} />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            autoFocus
            placeholder="Buscar pessoa..."
            className="flex-1 bg-transparent text-[13px] text-zinc-100 outline-none placeholder-zinc-600"
            style={{ boxShadow: 'none' }}
          />
        </div>

        <div style={{ maxHeight: 300, overflowY: 'auto', padding: 6 }}>
          {filtered.length === 0 ? (
            <div style={{ padding: 18, textAlign: 'center', fontSize: 13, color: '#6d6d75' }}>Nenhuma pessoa encontrada</div>
          ) : (
            filtered.map((p) => {
              const checked = selected.has(p.id)
              const initial = (p.name?.trim() || p.email || '?').charAt(0).toUpperCase()
              return (
                <button
                  key={p.id}
                  onClick={() => toggle(p.id)}
                  className="flex w-full items-center rounded-lg text-left transition-colors"
                  style={{ gap: 10, padding: '8px 10px', backgroundColor: checked ? 'rgba(16,185,129,0.10)' : 'transparent' }}
                  onMouseEnter={(e) => { if (!checked) e.currentTarget.style.backgroundColor = '#2a2a2a' }}
                  onMouseLeave={(e) => { if (!checked) e.currentTarget.style.backgroundColor = 'transparent' }}
                >
                  {p.avatar_url ? (
                    <img src={p.avatar_url} alt="" style={{ width: 26, height: 26, borderRadius: 999, objectFit: 'cover', flexShrink: 0 }} />
                  ) : (
                    <span style={{ width: 26, height: 26, borderRadius: 999, backgroundColor: 'rgba(16,185,129,0.16)', color: '#34d399', fontSize: 12, fontWeight: 600, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                      {initial}
                    </span>
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="truncate" style={{ fontSize: 13, color: '#e7e7ea' }}>{p.name ?? p.email}</div>
                    <div className="truncate" style={{ fontSize: 11, color: '#6d6d75' }}>{ROLE_LABELS[p.role] ?? p.role}</div>
                  </div>
                  <span
                    className="flex items-center justify-center"
                    style={{ width: 20, height: 20, borderRadius: 6, border: checked ? 'none' : '1.5px solid #3f3f46', backgroundColor: checked ? '#10b981' : 'transparent', flexShrink: 0 }}
                  >
                    {checked && <Check size={13} style={{ color: '#fff' }} />}
                  </span>
                </button>
              )
            })
          )}
        </div>

        {kind === 'note' && (
          <div className="flex items-center gap-2" style={{ padding: '12px 18px 4px' }}>
            <span style={{ fontSize: 12, color: '#8a8a92' }}>Permissão:</span>
            <div className="flex items-center" style={{ gap: 4, padding: 3, borderRadius: 9, backgroundColor: '#1a1a1a', border: '1px solid #2a2a2a' }}>
              {(['EDIT', 'VIEW'] as const).map((p) => {
                const isSel = permission === p
                const Icon = p === 'EDIT' ? Pencil : Eye
                return (
                  <button
                    key={p}
                    onClick={() => setPermission(p)}
                    className="flex items-center gap-1.5 rounded-md transition-colors"
                    style={{
                      height: 26, padding: '0 10px', fontSize: 12, fontWeight: 600,
                      backgroundColor: isSel ? 'rgba(16,185,129,0.16)' : 'transparent',
                      border: `1px solid ${isSel ? 'rgba(52,211,153,0.45)' : 'transparent'}`,
                      color: isSel ? '#6ee7b7' : '#8a8a92',
                    }}
                  >
                    <Icon size={13} />
                    {p === 'EDIT' ? 'Edição' : 'Leitura'}
                  </button>
                )
              })}
            </div>
          </div>
        )}

        <div className="flex items-center justify-between" style={{ padding: '12px 18px', borderTop: '1px solid #2a2a2a' }}>
          <span style={{ fontSize: 12, color: '#8a8a92' }}>
            {selected.size} selecionad{selected.size === 1 ? 'o' : 'os'}
          </span>
          <div className="flex items-center gap-2">
            <button onClick={onClose} className="rounded-md text-[13px] text-zinc-400 transition-colors hover:text-zinc-200" style={{ height: 32, padding: '0 14px' }}>
              Cancelar
            </button>
            <button onClick={() => void handleConfirm()} className="rounded-md text-[13px] font-medium text-white transition-colors" style={{ height: 32, padding: '0 16px', backgroundColor: '#10b981' }}>
              Compartilhar
            </button>
          </div>
        </div>

        <div style={{ padding: '0 18px 14px' }}>
          <span style={{ fontSize: 11, color: '#6d6d75' }}>
            {kind === 'category'
              ? 'A categoria aparecerá na conta de cada pessoa, marcada como compartilhada. Elas poderão abrir e editar as notas dentro dela.'
              : permission === 'EDIT'
                ? 'A pessoa verá esta nota na conta dela e poderá editar o conteúdo.'
                : 'A pessoa verá esta nota na conta dela, somente para leitura.'}
          </span>
        </div>
      </div>
    </div>
  )
}
