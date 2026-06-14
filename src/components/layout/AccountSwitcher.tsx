import { useRef, useState, useEffect } from 'react'
import { ChevronDown, Check, UserRound } from 'lucide-react'
import { useAuthStore } from '../../stores/auth-store'
import type { Profile, UserRole } from '../../lib/types'

const ROLE_LABELS: Partial<Record<UserRole, string>> = {
  DONO: 'Dono',
  GERENTE: 'Gerente',
  COORDENADOR: 'Coordenador',
  FUNCIONARIO: 'Funcionário',
  GUEST: 'Convidado',
  GESTOR_TRAFEGO: 'Gestor de Tráfego',
  VENDEDOR: 'Vendedor',
  FINANCEIRO: 'Financeiro',
}

type AvatarSource = { name: string | null; email: string; avatar_url: string | null }

function Avatar({ profile, size = 22 }: { profile: AvatarSource; size?: number }) {
  if (profile.avatar_url) {
    return <img src={profile.avatar_url} alt="" style={{ width: size, height: size, borderRadius: 999, objectFit: 'cover', flexShrink: 0 }} />
  }
  const initial = (profile.name?.trim() || profile.email || '?').charAt(0).toUpperCase()
  return (
    <span
      style={{
        width: size, height: size, borderRadius: 999,
        backgroundColor: 'rgba(16,185,129,0.16)', color: '#34d399',
        fontSize: Math.round(size * 0.45), fontWeight: 600,
        display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
      }}
    >
      {initial}
    </span>
  )
}

/**
 * Seletor de contas (impersonação front-first). O Dono enxerga todos; clicar
 * passa a visualizar as notas daquela conta. O filtro por hierarquia de cargos
 * e o carregamento real dependem da policy de RLS no back.
 */
export default function AccountSwitcher() {
  const user = useAuthStore((s) => s.user)
  const profile = useAuthStore((s) => s.profile)
  const teamProfiles = useAuthStore((s) => s.teamProfiles)
  const viewingAs = useAuthStore((s) => s.viewingAs)
  const setViewingAs = useAuthStore((s) => s.setViewingAs)

  const [isOpen, setIsOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!isOpen) return
    const onDown = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setIsOpen(false)
    }
    window.addEventListener('mousedown', onDown)
    return () => window.removeEventListener('mousedown', onDown)
  }, [isOpen])

  const selfProfile: Profile | null =
    profile ??
    (user ? { id: user.id, name: null, email: user.email ?? '—', avatar_url: null, role: 'DONO', created_at: '', updated_at: '' } : null)

  const others = teamProfiles.filter((p) => p.id !== user?.id)
  const impersonating = viewingAs !== null

  const choose = async (p: Profile | null) => {
    setIsOpen(false)
    await setViewingAs(p)
  }

  return (
    <div ref={containerRef} className="titlebar-no-drag relative">
      <button
        onClick={() => setIsOpen((v) => !v)}
        className="flex items-center gap-1.5 rounded-md"
        style={{
          height: 28,
          padding: '0 8px',
          backgroundColor: impersonating ? 'rgba(16,185,129,0.12)' : isOpen ? '#232323' : 'transparent',
          border: impersonating ? '1px solid rgba(16,185,129,0.3)' : '1px solid transparent',
          transition: 'background-color 140ms',
        }}
        onMouseEnter={(e) => { if (!impersonating && !isOpen) e.currentTarget.style.backgroundColor = '#232323' }}
        onMouseLeave={(e) => { if (!impersonating && !isOpen) e.currentTarget.style.backgroundColor = 'transparent' }}
        title={impersonating ? `Vendo como ${viewingAs?.name ?? viewingAs?.email}` : 'Trocar de conta'}
      >
        {impersonating && viewingAs ? (
          <>
            <Avatar profile={viewingAs} size={18} />
            <span className="truncate" style={{ maxWidth: 120, fontSize: 12, fontWeight: 500, color: '#6ee7b7' }}>
              {viewingAs.name ?? viewingAs.email}
            </span>
          </>
        ) : (
          <UserRound size={15} style={{ color: '#969696' }} />
        )}
        <ChevronDown size={12} style={{ color: '#71717a', transform: isOpen ? 'rotate(180deg)' : 'none', transition: 'transform 160ms' }} />
      </button>

      {isOpen && (
        <div
          className="absolute right-0 z-50 overflow-hidden"
          style={{ top: 'calc(100% + 6px)', minWidth: 248, backgroundColor: '#202020', border: '1px solid #353535', borderRadius: 12, boxShadow: '0 16px 40px rgba(0,0,0,0.55)' }}
        >
          <div style={{ padding: '10px 12px 6px' }}>
            <span style={{ fontSize: '10.5px', fontWeight: 600, letterSpacing: '0.6px', color: '#6d6d75', textTransform: 'uppercase' }}>
              Trocar de conta
            </span>
          </div>

          <div className="flex flex-col" style={{ gap: 2, padding: '0 8px 8px', maxHeight: 360, overflowY: 'auto' }}>
            {selfProfile && (
              <button
                onClick={() => void choose(null)}
                className="flex w-full items-center rounded-lg text-left transition-colors"
                style={{ gap: 10, padding: '8px 10px', backgroundColor: !impersonating ? 'rgba(16,185,129,0.10)' : 'transparent' }}
                onMouseEnter={(e) => { if (impersonating) e.currentTarget.style.backgroundColor = '#2a2a2a' }}
                onMouseLeave={(e) => { if (impersonating) e.currentTarget.style.backgroundColor = 'transparent' }}
              >
                <Avatar profile={selfProfile} />
                <div className="min-w-0 flex-1">
                  <div className="truncate" style={{ fontSize: '13px', color: '#e7e7ea' }}>{selfProfile.name ?? selfProfile.email}</div>
                  <div className="truncate" style={{ fontSize: '11px', color: '#6d6d75' }}>Você · {ROLE_LABELS[selfProfile.role]}</div>
                </div>
                {!impersonating && <Check size={14} style={{ color: '#10b981', flexShrink: 0 }} />}
              </button>
            )}

            {others.length > 0 && <div style={{ height: 1, backgroundColor: '#2a2a2a', margin: '4px 6px' }} />}

            {others.map((p) => {
              const isCurrent = viewingAs?.id === p.id
              return (
                <button
                  key={p.id}
                  onClick={() => void choose(p)}
                  className="flex w-full items-center rounded-lg text-left transition-colors"
                  style={{ gap: 10, padding: '8px 10px', backgroundColor: isCurrent ? 'rgba(16,185,129,0.10)' : 'transparent' }}
                  onMouseEnter={(e) => { if (!isCurrent) e.currentTarget.style.backgroundColor = '#2a2a2a' }}
                  onMouseLeave={(e) => { if (!isCurrent) e.currentTarget.style.backgroundColor = 'transparent' }}
                >
                  <Avatar profile={p} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate" style={{ fontSize: '13px', color: '#e7e7ea' }}>{p.name ?? p.email}</div>
                    <div className="truncate" style={{ fontSize: '11px', color: '#6d6d75' }}>{ROLE_LABELS[p.role]}</div>
                  </div>
                  {isCurrent && <Check size={14} style={{ color: '#10b981', flexShrink: 0 }} />}
                </button>
              )
            })}

            {others.length === 0 && (
              <div style={{ padding: '8px 10px', fontSize: '12px', color: '#6d6d75' }}>Nenhuma outra conta disponível</div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
