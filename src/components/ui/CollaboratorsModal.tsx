import { useState, useEffect, useRef } from 'react'
import { X, Search } from 'lucide-react'
import { useCollaboratorsStore } from '../../stores/collaborators-store'
import type { Profile, NotePermission } from '../../lib/types'

interface CollaboratorsModalProps {
  noteId: string
  onClose: () => void
}

function Avatar({ profile }: { profile: Profile }) {
  const initials = profile.name
    ?.split(' ').slice(0, 2).map((n) => n[0]).join('').toUpperCase()
    ?? profile.email[0].toUpperCase()

  if (profile.avatar_url) {
    return (
      <img
        src={profile.avatar_url}
        className="h-7 w-7 rounded-full object-cover"
        alt={profile.name ?? profile.email}
      />
    )
  }
  return (
    <div
      className="flex h-7 w-7 items-center justify-center rounded-full text-xs font-medium"
      style={{ backgroundColor: '#065f46', color: '#a7f3d0' }}
    >
      {initials}
    </div>
  )
}

export default function CollaboratorsModal({ noteId, onClose }: CollaboratorsModalProps) {
  console.log('[MODAL] CollaboratorsModal montado, noteId:', noteId)

  const {
    collaborators, isLoading,
    allProfiles,
    loadCollaborators, loadAllProfiles,
    addCollaborator, updatePermission, removeCollaborator,
  } = useCollaboratorsStore()

  const [searchQuery, setSearchQuery] = useState('')
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null)
  const [newPermission, setNewPermission] = useState<NotePermission>('EDIT')
  const searchRef = useRef<HTMLInputElement>(null)

  const profilesLoaded = useCollaboratorsStore((s) => s.profilesLoaded)

  useEffect(() => {
    console.log('[MODAL] useEffect disparado')
    void loadCollaborators(noteId)
    void loadAllProfiles().then(() => {
      console.log('[MODAL] allProfiles após load:', allProfiles.length, 'profilesLoaded:', profilesLoaded)
    })
  }, [noteId, loadCollaborators, loadAllProfiles])

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  const collaboratorUserIds = new Set(collaborators.map((c) => c.user_id))

  const filteredProfiles = allProfiles.filter((p) => {
    if (collaboratorUserIds.has(p.id)) return false
    if (!searchQuery.trim()) return true
    const q = searchQuery.toLowerCase()
    return (
      (p.name?.toLowerCase().includes(q) ?? false) ||
      p.email.toLowerCase().includes(q)
    )
  })

  const handleAdd = async () => {
    console.log('[ADD] handleAdd chamado, selectedUserId:', selectedUserId, 'noteId:', noteId, 'permission:', newPermission)
    if (!selectedUserId) return
    await addCollaborator(noteId, selectedUserId, newPermission)
    setSelectedUserId(null)
    setSearchQuery('')
  }

  const handleTogglePermission = (collaboratorId: string, current: NotePermission) => {
    const next: NotePermission = current === 'EDIT' ? 'VIEW' : 'EDIT'
    void updatePermission(collaboratorId, next)
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ backgroundColor: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)' }}
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div
        style={{
          width: '100%',
          maxWidth: '420px',
          maxHeight: '80vh',
          display: 'flex',
          flexDirection: 'column',
          backgroundColor: '#1e1e1e',
          borderRadius: '12px',
          border: '1px solid #3d3d3d',
          boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
        }}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between"
          style={{ padding: '16px 20px', borderBottom: '1px solid #3d3d3d' }}
        >
          <span style={{ fontSize: '16px', fontWeight: 600, color: '#cccccc' }}>
            Colaboradores
          </span>
          <button
            onClick={onClose}
            className="flex h-7 w-7 items-center justify-center rounded transition-colors duration-150"
            style={{ color: '#6d6d6d' }}
            onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = '#333333'; e.currentTarget.style.color = '#cccccc' }}
            onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; e.currentTarget.style.color = '#6d6d6d' }}
          >
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <div style={{ padding: '16px 20px', overflowY: 'auto', flex: 1 }}>
          {/* Colaboradores atuais */}
          <p style={{ fontSize: '11px', color: '#6d6d6d', marginBottom: '8px', letterSpacing: '0.5px' }}>
            COLABORADORES ATUAIS
          </p>

          {isLoading ? (
            <p style={{ fontSize: '13px', color: '#6d6d6d', marginBottom: '16px' }}>Carregando...</p>
          ) : collaborators.length === 0 ? (
            <p style={{ fontSize: '13px', color: '#6d6d6d', marginBottom: '16px' }}>Nenhum colaborador ainda</p>
          ) : (
            <div style={{ marginBottom: '16px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
              {collaborators.map((collab) => {
                const profile = collab.profile
                if (!profile) return null
                return (
                  <div
                    key={collab.id}
                    className="flex items-center gap-3"
                    style={{ padding: '6px 8px', borderRadius: '8px' }}
                    onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = '#252526' }}
                    onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent' }}
                  >
                    <Avatar profile={profile} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: '13px', color: '#cccccc', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {profile.name ?? profile.email}
                      </div>
                    </div>
                    <button
                      onClick={() => handleTogglePermission(collab.id, collab.permission)}
                      className="rounded text-[11px] font-medium transition-colors duration-150"
                      style={{
                        padding: '2px 8px',
                        backgroundColor: collab.permission === 'EDIT' ? '#065f46' : '#1e3a5f',
                        color: collab.permission === 'EDIT' ? '#a7f3d0' : '#93c5fd',
                        cursor: 'pointer',
                      }}
                    >
                      {collab.permission === 'EDIT' ? 'EDITAR' : 'VISUALIZAR'}
                    </button>
                    <button
                      onClick={() => void removeCollaborator(collab.id)}
                      className="flex h-6 w-6 items-center justify-center rounded transition-colors duration-150"
                      style={{ color: '#6d6d6d' }}
                      onMouseEnter={(e) => { e.currentTarget.style.color = '#ef4444'; e.currentTarget.style.backgroundColor = '#333333' }}
                      onMouseLeave={(e) => { e.currentTarget.style.color = '#6d6d6d'; e.currentTarget.style.backgroundColor = 'transparent' }}
                    >
                      <X size={14} />
                    </button>
                  </div>
                )
              })}
            </div>
          )}

          {/* Adicionar membro */}
          <p style={{ fontSize: '11px', color: '#6d6d6d', marginBottom: '8px', letterSpacing: '0.5px' }}>
            ADICIONAR MEMBRO
          </p>

          <div
            className="flex items-center gap-2"
            style={{
              backgroundColor: '#252526',
              border: '1px solid #3d3d3d',
              borderRadius: '8px',
              padding: '0 10px',
              marginBottom: '8px',
            }}
          >
            <Search size={14} style={{ color: '#6d6d6d', flexShrink: 0 }} />
            <input
              ref={searchRef}
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Buscar membro..."
              className="w-full outline-none"
              style={{
                backgroundColor: 'transparent',
                color: '#cccccc',
                fontSize: '13px',
                height: '34px',
                border: 'none',
              }}
            />
          </div>

          <div
            style={{
              maxHeight: '160px',
              overflowY: 'auto',
              marginBottom: '12px',
              borderRadius: '8px',
              border: filteredProfiles.length > 0 ? '1px solid #3d3d3d' : 'none',
            }}
          >
            {filteredProfiles.length === 0 && searchQuery.trim() ? (
              <p style={{ fontSize: '13px', color: '#6d6d6d', padding: '8px 12px' }}>Nenhum membro encontrado</p>
            ) : (
              filteredProfiles.map((profile) => {
                const isSelected = selectedUserId === profile.id
                return (
                  <button
                    key={profile.id}
                    onClick={() => setSelectedUserId(isSelected ? null : profile.id)}
                    className="flex w-full items-center gap-3 text-left transition-colors duration-150"
                    style={{
                      padding: '8px 12px',
                      backgroundColor: isSelected ? '#065f46' : 'transparent',
                    }}
                    onMouseEnter={(e) => { if (!isSelected) e.currentTarget.style.backgroundColor = '#252526' }}
                    onMouseLeave={(e) => { if (!isSelected) e.currentTarget.style.backgroundColor = 'transparent' }}
                  >
                    <Avatar profile={profile} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: '13px', color: isSelected ? '#a7f3d0' : '#cccccc', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {profile.name ?? profile.email}
                      </div>
                      <div style={{ fontSize: '11px', color: isSelected ? '#6ee7b7' : '#6d6d6d', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {profile.email}
                      </div>
                    </div>
                  </button>
                )
              })
            )}
          </div>

          {/* Permissão + Adicionar */}
          {selectedUserId && (
            <div className="flex items-center gap-3" style={{ marginBottom: '12px' }}>
              <span style={{ fontSize: '12px', color: '#6d6d6d' }}>Permissão:</span>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setNewPermission('EDIT')}
                  className="rounded text-[12px] font-medium transition-colors duration-150"
                  style={{
                    padding: '3px 10px',
                    backgroundColor: newPermission === 'EDIT' ? '#065f46' : '#252526',
                    color: newPermission === 'EDIT' ? '#a7f3d0' : '#6d6d6d',
                    border: `1px solid ${newPermission === 'EDIT' ? '#10b981' : '#3d3d3d'}`,
                  }}
                >
                  EDITAR
                </button>
                <button
                  onClick={() => setNewPermission('VIEW')}
                  className="rounded text-[12px] font-medium transition-colors duration-150"
                  style={{
                    padding: '3px 10px',
                    backgroundColor: newPermission === 'VIEW' ? '#1e3a5f' : '#252526',
                    color: newPermission === 'VIEW' ? '#93c5fd' : '#6d6d6d',
                    border: `1px solid ${newPermission === 'VIEW' ? '#3b82f6' : '#3d3d3d'}`,
                  }}
                >
                  VISUALIZAR
                </button>
              </div>
              <button
                onClick={() => void handleAdd()}
                className="rounded text-[12px] font-medium text-white transition-colors duration-150 hover:bg-emerald-500"
                style={{
                  padding: '3px 12px',
                  backgroundColor: '#059669',
                  marginLeft: 'auto',
                }}
              >
                Adicionar
              </button>
            </div>
          )}
        </div>

        {/* Footer */}
        <div
          className="flex justify-end"
          style={{ padding: '12px 20px', borderTop: '1px solid #3d3d3d' }}
        >
          <button
            onClick={onClose}
            className="rounded-lg transition-colors duration-150"
            style={{
              height: '32px',
              padding: '0 16px',
              fontSize: '13px',
              backgroundColor: '#333333',
              color: '#cccccc',
            }}
            onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = '#3d3d3d' }}
            onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = '#333333' }}
          >
            Fechar
          </button>
        </div>
      </div>
    </div>
  )
}
