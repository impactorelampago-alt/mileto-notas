import { useEffect, useRef, useState, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { ImagePlus, Copy, Check, Trash2, X, XCircle, Loader2, AtSign } from 'lucide-react'
import { useMediaStore, ACCEPT_ATTR } from '../../stores/media-store'
import type { NoteMedia } from '../../lib/types'

interface Props {
  noteId: string
  canEdit: boolean
  /** Insere uma menção {{img:id}} no texto do editor (só quando pode editar). */
  onMentionImage?: (m: NoteMedia) => void
}

const THUMB = 76

export default function NoteMediaStrip({ noteId, canEdit, onMentionImage }: Props) {
  const media = useMediaStore((s) => s.mediaByNote[noteId])
  const uploading = useMediaStore((s) => s.uploadingByNote[noteId] ?? 0)
  const copyingId = useMediaStore((s) => s.copyingId)
  const loadMedia = useMediaStore((s) => s.loadMedia)
  const uploadFiles = useMediaStore((s) => s.uploadFiles)
  const deleteMedia = useMediaStore((s) => s.deleteMedia)
  const copyMedia = useMediaStore((s) => s.copyMedia)
  const urlFor = useMediaStore((s) => s.urlFor)

  const inputRef = useRef<HTMLInputElement>(null)
  const [dragOver, setDragOver] = useState(false)
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [failedId, setFailedId] = useState<string | null>(null)
  const [lightbox, setLightbox] = useState<NoteMedia | null>(null)
  const [flashId, setFlashId] = useState<string | null>(null)
  const itemRefs = useRef<Record<string, HTMLDivElement | null>>({})
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    void loadMedia(noteId)
  }, [noteId, loadMedia])

  // Renova as signed URLs (TTL 2h) periodicamente enquanto a nota fica aberta.
  useEffect(() => {
    const id = setInterval(() => { void loadMedia(noteId) }, 90 * 60 * 1000)
    return () => clearInterval(id)
  }, [noteId, loadMedia])

  useEffect(() => () => { if (copiedTimer.current) clearTimeout(copiedTimer.current) }, [])

  // Clicar num chip {{img:id}} no editor dispara 'mileto:flash-image' com o id8:
  // rola até a imagem correspondente e a destaca por ~1.5s.
  useEffect(() => {
    const handler = (e: Event) => {
      const id8 = (e as CustomEvent<string>).detail
      if (!id8) return
      const match = (media ?? []).find((m) => m.id.slice(0, 8) === id8)
      if (!match) return
      setFlashId(id8)
      itemRefs.current[match.id]?.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' })
      window.setTimeout(() => setFlashId((cur) => (cur === id8 ? null : cur)), 1500)
    }
    document.addEventListener('mileto:flash-image', handler)
    return () => document.removeEventListener('mileto:flash-image', handler)
  }, [media])

  const items = media ?? []

  const handleFiles = useCallback(
    (files: FileList | File[] | null) => {
      if (!files || !canEdit) return
      void uploadFiles(noteId, files)
    },
    [canEdit, noteId, uploadFiles],
  )

  const handleCopy = useCallback(
    async (m: NoteMedia) => {
      const ok = await copyMedia(m)
      if (copiedTimer.current) clearTimeout(copiedTimer.current)
      if (ok) {
        setFailedId(null)
        setCopiedId(m.id)
        copiedTimer.current = setTimeout(() => setCopiedId(null), 1600)
      } else {
        // Não engole o erro: mostra feedback de falha (ex.: clipboard sem foco).
        setCopiedId(null)
        setFailedId(m.id)
        copiedTimer.current = setTimeout(() => setFailedId(null), 2200)
      }
    },
    [copyMedia],
  )

  // Esconde a faixa por completo quando não há mídia e não dá pra editar.
  if (items.length === 0 && uploading === 0 && !canEdit) return null

  const showEmptyDropzone = items.length === 0 && uploading === 0 && canEdit

  return (
    <div
      className="shrink-0"
      style={{ borderTop: '1px solid #353535', backgroundColor: '#262626' }}
      onDragOver={canEdit ? (e) => { e.preventDefault(); setDragOver(true) } : undefined}
      onDragLeave={canEdit ? () => setDragOver(false) : undefined}
      onDrop={canEdit ? (e) => { e.preventDefault(); setDragOver(false); handleFiles(e.dataTransfer.files) } : undefined}
    >
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPT_ATTR}
        multiple
        className="hidden"
        onChange={(e) => { handleFiles(e.target.files); e.target.value = '' }}
      />

      {showEmptyDropzone ? (
        <button
          onClick={() => inputRef.current?.click()}
          className="flex w-full items-center justify-center gap-2"
          style={{
            height: 40,
            margin: '8px 16px',
            width: 'calc(100% - 32px)',
            borderRadius: 9,
            border: `1px dashed ${dragOver ? '#34d399' : '#3d3d3d'}`,
            backgroundColor: dragOver ? 'rgba(16,185,129,0.08)' : 'transparent',
            color: dragOver ? '#6ee7b7' : '#6b6b72',
            fontSize: 12,
            transition: 'background-color 140ms, border-color 140ms, color 140ms',
          }}
          onMouseEnter={(e) => { if (!dragOver) { e.currentTarget.style.borderColor = '#4a4a4a'; e.currentTarget.style.color = '#9a9aa3' } }}
          onMouseLeave={(e) => { if (!dragOver) { e.currentTarget.style.borderColor = '#3d3d3d'; e.currentTarget.style.color = '#6b6b72' } }}
        >
          <ImagePlus size={15} />
          Arraste, cole (Ctrl+V) ou clique para adicionar imagem
        </button>
      ) : (
        <div
          className="flex items-center gap-2.5 overflow-x-auto"
          style={{
            padding: '12px 16px',
            backgroundColor: dragOver ? 'rgba(16,185,129,0.06)' : 'transparent',
            transition: 'background-color 140ms',
          }}
        >
          {items.map((m) => {
            const url = urlFor(m)
            const isCopied = copiedId === m.id
            const isFailed = failedId === m.id
            const isCopying = copyingId === m.id
            const isFlashing = flashId === m.id.slice(0, 8)
            return (
              <div
                key={m.id}
                ref={(el) => { itemRefs.current[m.id] = el }}
                className="group relative shrink-0 overflow-hidden"
                style={{
                  width: THUMB, height: THUMB, borderRadius: 10,
                  border: `1px solid ${isFlashing ? '#10b981' : '#3a3a3a'}`,
                  backgroundColor: '#1b1b1b',
                  boxShadow: isFlashing
                    ? '0 0 0 2px #10b981, 0 0 14px rgba(16,185,129,0.55)'
                    : '0 1px 3px rgba(0,0,0,0.3)',
                  transition: 'box-shadow 180ms, border-color 180ms',
                }}
              >
                <button
                  onClick={() => setLightbox(m)}
                  className="block h-full w-full"
                  title="Ver imagem"
                  style={{ cursor: 'zoom-in' }}
                >
                  {url ? (
                    <img src={url} alt={m.filename ?? 'imagem'} className="h-full w-full object-cover" draggable={false} />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center">
                      <Loader2 size={16} className="animate-spin" style={{ color: '#52525b' }} />
                    </div>
                  )}
                </button>

                {/* Ações no hover */}
                <div
                  className="pointer-events-none absolute inset-0 flex items-start justify-end gap-1 p-1.5 opacity-0 transition-opacity group-hover:opacity-100"
                  style={{ background: 'linear-gradient(to bottom, rgba(0,0,0,0.55), rgba(0,0,0,0) 55%)' }}
                >
                  {canEdit && onMentionImage && (
                    <button
                      onClick={(e) => { e.stopPropagation(); onMentionImage(m) }}
                      title="Mencionar no texto"
                      className="pointer-events-auto flex items-center justify-center rounded-md"
                      style={{ width: 22, height: 22, backgroundColor: 'rgba(20,20,20,0.8)', color: '#e4e4e4', backdropFilter: 'blur(2px)' }}
                      onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = 'rgba(16,185,129,0.9)'; e.currentTarget.style.color = '#06120d' }}
                      onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'rgba(20,20,20,0.8)'; e.currentTarget.style.color = '#e4e4e4' }}
                    >
                      <AtSign size={12} />
                    </button>
                  )}
                  <button
                    onClick={(e) => { e.stopPropagation(); void handleCopy(m) }}
                    title={isFailed ? 'Falha ao copiar' : isCopied ? 'Copiado!' : 'Copiar imagem'}
                    className="pointer-events-auto flex items-center justify-center rounded-md"
                    style={{
                      width: 22, height: 22,
                      backgroundColor: isCopied ? 'rgba(16,185,129,0.9)' : isFailed ? 'rgba(239,68,68,0.9)' : 'rgba(20,20,20,0.8)',
                      color: isCopied ? '#06120d' : '#e4e4e4',
                      backdropFilter: 'blur(2px)',
                    }}
                  >
                    {isCopying ? <Loader2 size={12} className="animate-spin" /> : isCopied ? <Check size={12} strokeWidth={3} /> : isFailed ? <XCircle size={12} /> : <Copy size={12} />}
                  </button>
                  {canEdit && (
                    <button
                      onClick={(e) => { e.stopPropagation(); void deleteMedia(noteId, m) }}
                      title="Excluir"
                      className="pointer-events-auto flex items-center justify-center rounded-md"
                      style={{ width: 22, height: 22, backgroundColor: 'rgba(20,20,20,0.8)', color: '#e4e4e4', backdropFilter: 'blur(2px)' }}
                      onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = 'rgba(239,68,68,0.9)' }}
                      onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'rgba(20,20,20,0.8)' }}
                    >
                      <Trash2 size={12} />
                    </button>
                  )}
                </div>
              </div>
            )
          })}

          {/* Placeholders de upload em curso */}
          {Array.from({ length: uploading }).map((_, i) => (
            <div
              key={`up-${i}`}
              className="shrink-0 animate-pulse"
              style={{ width: THUMB, height: THUMB, borderRadius: 10, border: '1px solid #3a3a3a', backgroundColor: '#242424', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
            >
              <Loader2 size={18} className="animate-spin" style={{ color: '#34d399' }} />
            </div>
          ))}

          {/* Tile de adicionar */}
          {canEdit && (
            <button
              onClick={() => inputRef.current?.click()}
              title="Adicionar imagem (ou cole com Ctrl+V)"
              className="flex shrink-0 flex-col items-center justify-center gap-1"
              style={{
                width: THUMB, height: THUMB, borderRadius: 10,
                border: '1px dashed #3d3d3d', color: '#6b6b72', backgroundColor: 'transparent',
                transition: 'background-color 140ms, border-color 140ms, color 140ms',
              }}
              onMouseEnter={(e) => { e.currentTarget.style.borderColor = '#34d399'; e.currentTarget.style.color = '#6ee7b7'; e.currentTarget.style.backgroundColor = 'rgba(16,185,129,0.06)' }}
              onMouseLeave={(e) => { e.currentTarget.style.borderColor = '#3d3d3d'; e.currentTarget.style.color = '#6b6b72'; e.currentTarget.style.backgroundColor = 'transparent' }}
            >
              <ImagePlus size={18} />
            </button>
          )}
        </div>
      )}

      {/* Lightbox / preview */}
      <AnimatePresence>
        {lightbox && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="fixed inset-0 z-[80] flex items-center justify-center"
            style={{ backgroundColor: 'rgba(0,0,0,0.82)' }}
            onClick={() => setLightbox(null)}
          >
            <motion.div
              initial={{ scale: 0.96 }}
              animate={{ scale: 1 }}
              exit={{ scale: 0.96 }}
              transition={{ duration: 0.15 }}
              className="relative flex flex-col items-center"
              style={{ maxWidth: '88vw', maxHeight: '88vh' }}
              onClick={(e) => e.stopPropagation()}
            >
              {urlFor(lightbox) && (
                <img
                  src={urlFor(lightbox)}
                  alt={lightbox.filename ?? 'imagem'}
                  style={{ maxWidth: '88vw', maxHeight: '80vh', borderRadius: 12, boxShadow: '0 20px 60px rgba(0,0,0,0.6)' }}
                  draggable={false}
                />
              )}
              <div className="mt-3 flex items-center gap-2">
                <button
                  onClick={() => void handleCopy(lightbox)}
                  className="flex items-center gap-2 rounded-lg"
                  style={{
                    padding: '8px 14px',
                    backgroundColor: copiedId === lightbox.id ? 'rgba(16,185,129,0.92)' : failedId === lightbox.id ? 'rgba(239,68,68,0.92)' : '#2a2a2a',
                    color: copiedId === lightbox.id ? '#06120d' : '#e4e4e4',
                    fontSize: 12.5, fontWeight: 600, border: '1px solid #3a3a3a',
                  }}
                >
                  {copiedId === lightbox.id ? <Check size={14} strokeWidth={3} /> : failedId === lightbox.id ? <XCircle size={14} /> : <Copy size={14} />}
                  {copiedId === lightbox.id ? 'Copiado!' : failedId === lightbox.id ? 'Falha ao copiar' : 'Copiar imagem'}
                </button>
                <button
                  onClick={() => setLightbox(null)}
                  className="flex items-center justify-center rounded-lg"
                  style={{ width: 36, height: 36, backgroundColor: '#2a2a2a', color: '#e4e4e4', border: '1px solid #3a3a3a' }}
                  title="Fechar"
                >
                  <X size={16} />
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
