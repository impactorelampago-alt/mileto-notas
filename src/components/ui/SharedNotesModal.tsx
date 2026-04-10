import { useState, useEffect } from 'react'
import { X, FileText } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuthStore } from '../../stores/auth-store'
import type { NotePermission } from '../../lib/types'

interface SharedNotesModalProps {
  onClose: () => void
  onOpenNote: (noteId: string, permission: NotePermission) => void
}

interface SharedNoteItem {
  collaboratorId: string
  permission: NotePermission
  note: { id: string; title: string; updated_at: string; creator_id: string }
  creator: { id: string; name: string | null; email: string } | undefined
}

function formatRelativeDate(dateStr: string): string {
  const date = new Date(dateStr)
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffMin = Math.floor(diffMs / 60000)
  const diffHours = Math.floor(diffMs / 3600000)
  const diffDays = Math.floor(diffMs / 86400000)

  if (diffMin < 1) return 'agora'
  if (diffMin < 60) return `há ${diffMin} min`
  if (diffHours < 24) return `há ${diffHours}h`
  if (diffDays === 1) return 'ontem'
  if (diffDays < 7) return `há ${diffDays} dias`
  return date.toLocaleDateString('pt-BR')
}

export default function SharedNotesModal({ onClose, onOpenNote }: SharedNotesModalProps) {
  const [items, setItems] = useState<SharedNoteItem[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const currentUserId = useAuthStore((s) => s.user?.id)

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  useEffect(() => {
    if (!currentUserId) return

    const load = async () => {
      setIsLoading(true)

      const { data: collabs, error: collabError } = await supabase
        .from('note_collaborators')
        .select('id, permission, note_id, added_by')
        .eq('user_id', currentUserId)

      if (collabError || !collabs || collabs.length === 0) {
        setItems([])
        setIsLoading(false)
        return
      }

      const noteIds = collabs.map((c) => c.note_id)
      const { data: sharedNotes } = await supabase
        .from('notes')
        .select('id, title, updated_at, creator_id')
        .in('id', noteIds)

      const creatorIds = [...new Set((sharedNotes ?? []).map((n) => n.creator_id))]
      const { data: creators } = await supabase
        .from('profiles')
        .select('id, name, email')
        .in('id', creatorIds)

      const list: SharedNoteItem[] = collabs
        .map((c) => {
          const note = sharedNotes?.find((n) => n.id === c.note_id)
          if (!note) return null
          return {
            collaboratorId: c.id,
            permission: c.permission as NotePermission,
            note,
            creator: creators?.find((p) => p.id === note.creator_id),
          }
        })
        .filter((item): item is SharedNoteItem => item !== null)

      setItems(list)
      setIsLoading(false)
    }

    void load()
  }, [currentUserId])

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ backgroundColor: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)' }}
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div
        style={{
          width: '100%',
          maxWidth: '480px',
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
            Notas compartilhadas comigo
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
        <div style={{ padding: '12px 20px', overflowY: 'auto', flex: 1 }}>
          {isLoading ? (
            <p style={{ fontSize: '13px', color: '#6d6d6d', padding: '16px 0', textAlign: 'center' }}>Carregando...</p>
          ) : items.length === 0 ? (
            <p style={{ fontSize: '13px', color: '#6d6d6d', padding: '16px 0', textAlign: 'center' }}>
              Nenhuma nota foi compartilhada com você ainda
            </p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              {items.map((item) => (
                <div
                  key={item.collaboratorId}
                  className="flex items-start gap-3"
                  style={{ padding: '10px 12px', borderRadius: '8px' }}
                  onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = '#252526' }}
                  onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent' }}
                >
                  <FileText size={18} style={{ color: '#6d6d6d', flexShrink: 0, marginTop: '2px' }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: '13px', color: '#cccccc', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {item.note.title || 'Sem título'}
                    </div>
                    <div className="flex items-center gap-2" style={{ marginTop: '4px' }}>
                      <span style={{ fontSize: '11px', color: '#6d6d6d' }}>
                        Por: {item.creator?.name ?? item.creator?.email ?? 'Desconhecido'}
                      </span>
                      <span
                        className="rounded text-[10px] font-medium"
                        style={{
                          padding: '1px 6px',
                          backgroundColor: item.permission === 'EDIT' ? '#065f46' : '#252526',
                          color: item.permission === 'EDIT' ? '#a7f3d0' : '#969696',
                        }}
                      >
                        {item.permission === 'EDIT' ? 'EDITAR' : 'VISUALIZAR'}
                      </span>
                    </div>
                    <div style={{ fontSize: '11px', color: '#4d4d4d', marginTop: '2px' }}>
                      Editada: {formatRelativeDate(item.note.updated_at)}
                    </div>
                  </div>
                  <button
                    onClick={() => onOpenNote(item.note.id, item.permission)}
                    className="rounded text-[12px] font-medium text-white transition-colors duration-150 hover:bg-emerald-500"
                    style={{
                      padding: '4px 12px',
                      backgroundColor: '#059669',
                      flexShrink: 0,
                      marginTop: '2px',
                    }}
                  >
                    Abrir
                  </button>
                </div>
              ))}
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
            style={{ height: '32px', padding: '0 16px', fontSize: '13px', backgroundColor: '#333333', color: '#cccccc' }}
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
