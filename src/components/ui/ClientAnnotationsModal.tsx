import { useEffect, useMemo, useState } from 'react'
import { Building2, FileText, X } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import type { NoteClientAnnotation } from '../../lib/types'

interface ClientAnnotationsModalProps {
  visible: boolean
  clientId: string
  clientName: string
  onClose: () => void
}

interface AnnotationWithNoteTitle extends NoteClientAnnotation {
  noteTitle: string
}

export default function ClientAnnotationsModal({
  visible,
  clientId,
  clientName,
  onClose,
}: ClientAnnotationsModalProps) {
  const [annotations, setAnnotations] = useState<AnnotationWithNoteTitle[]>([])
  const [isLoading, setIsLoading] = useState(false)

  useEffect(() => {
    if (!visible) return
    setIsLoading(true)
    void (async () => {
      const { data, error } = await supabase
        .from('note_client_annotations')
        .select('id, note_id, client_id, excerpt, selection_start, selection_end, created_by, created_at')
        .eq('client_id', clientId)
        .order('created_at', { ascending: false })

      if (error) {
        console.error('[annotations] list:', error.message)
        setAnnotations([])
        setIsLoading(false)
        return
      }

      const baseRows = (data ?? []) as NoteClientAnnotation[]
      const noteIds = Array.from(new Set(baseRows.map((row) => row.note_id)))
      const { data: notesData } = await supabase
        .from('notes')
        .select('id, title')
        .in('id', noteIds)

      const noteTitleMap = new Map<string, string>((notesData ?? []).map((note) => [note.id as string, note.title as string]))
      setAnnotations(baseRows.map((row) => ({
        ...row,
        noteTitle: noteTitleMap.get(row.note_id) ?? 'Nota sem título',
      })))
      setIsLoading(false)
    })()
  }, [visible, clientId])

  useEffect(() => {
    if (!visible) return
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [visible, onClose])

  const emptyMessage = useMemo(
    () => `Nenhuma anotação vinculada a ${clientName}.`,
    [clientName],
  )

  if (!visible) return null

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center"
      style={{ backgroundColor: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)' }}
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div
        style={{
          width: '100%',
          maxWidth: '640px',
          maxHeight: '80vh',
          display: 'flex',
          flexDirection: 'column',
          backgroundColor: '#1e1e1e',
          borderRadius: '12px',
          border: '1px solid #3d3d3d',
          boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
        }}
      >
        <div className="flex items-center justify-between" style={{ padding: '16px 20px', borderBottom: '1px solid #3d3d3d' }}>
          <div className="flex items-center gap-2">
            <Building2 size={16} style={{ color: '#10b981' }} />
            <span style={{ fontSize: '16px', fontWeight: 600, color: '#cccccc' }}>Anotações da empresa</span>
          </div>
          <button onClick={onClose} className="flex h-7 w-7 items-center justify-center rounded" style={{ color: '#6d6d6d' }}>
            <X size={16} />
          </button>
        </div>

        <div style={{ padding: '8px 20px 0 20px', color: '#a1a1aa', fontSize: '12px' }}>
          {clientName}
        </div>

        <div style={{ padding: '16px 20px', overflowY: 'auto', flex: 1 }}>
          {isLoading ? (
            <p style={{ color: '#6d6d6d', fontSize: '13px', textAlign: 'center', padding: '24px 0' }}>Carregando anotações...</p>
          ) : annotations.length === 0 ? (
            <p style={{ color: '#6d6d6d', fontSize: '13px', textAlign: 'center', padding: '24px 0' }}>{emptyMessage}</p>
          ) : (
            <div className="flex flex-col gap-3">
              {annotations.map((annotation) => (
                <div
                  key={annotation.id}
                  style={{
                    backgroundColor: '#252526',
                    border: '1px solid #333333',
                    borderRadius: '10px',
                    padding: '12px',
                  }}
                >
                  <div className="flex items-center gap-2" style={{ marginBottom: '8px' }}>
                    <FileText size={13} style={{ color: '#6d6d6d' }} />
                    <span style={{ color: '#d4d4d8', fontSize: '12px', fontWeight: 600 }}>{annotation.noteTitle}</span>
                    <span style={{ color: '#71717a', fontSize: '11px' }}>
                      {new Date(annotation.created_at).toLocaleString('pt-BR')}
                    </span>
                  </div>
                  <div style={{ color: '#cccccc', fontSize: '13px', lineHeight: 1.55, whiteSpace: 'pre-wrap' }}>
                    {annotation.excerpt}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
