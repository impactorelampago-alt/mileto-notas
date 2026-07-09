import { create } from 'zustand'
import { supabase } from '../lib/supabase'
import { useAuthStore } from './auth-store'
import type { NoteMedia } from '../lib/types'
import { copyImageToClipboard } from '../lib/clipboard-image'

/**
 * Mídias (imagens) anexadas às notas. Arquivos vão pro Supabase Storage privado
 * (bucket `note-media`); os metadados pra tabela `note_media`. A exibição usa
 * signed URLs (curta validade). Quem acessa a nota vê; quem edita pode anexar.
 */
const BUCKET = 'note-media'
const SIGNED_TTL = 60 * 60 * 2 // 2 horas
export const MAX_MEDIA_SIZE = 250 * 1024 * 1024 // 250 MB (bate com o file_size_limit do bucket)

const IMAGE_EXT: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/avif': 'avif',
}
// Raster que dá pra COPIAR via canvas (createImageBitmap). Vídeo/arquivo/SVG só baixam.
const RASTER_MIME = new Set(Object.keys(IMAGE_EXT))
export function isRasterImage(mime: string | null | undefined): boolean { return !!mime && RASTER_MIME.has(mime) }
export function isImageMime(mime: string | null | undefined): boolean { return !!mime && mime.startsWith('image/') }
export function isVideoMime(mime: string | null | undefined): boolean { return !!mime && mime.startsWith('video/') }

// O bucket aceita QUALQUER tipo agora (vídeo + arquivos) → picker sem restrição.
export const ACCEPT_ATTR = ''

function extFor(file: File): string {
  const fromName = file.name?.includes('.') ? file.name.split('.').pop()!.toLowerCase() : ''
  if (fromName) return fromName
  return IMAGE_EXT[file.type] ?? (file.type.split('/')[1] || 'bin')
}

interface MediaState {
  mediaByNote: Record<string, NoteMedia[]>
  urlByPath: Record<string, string>
  uploadingByNote: Record<string, number>
  copyingId: string | null
  loadMedia: (noteId: string) => Promise<void>
  uploadFiles: (noteId: string, files: File[] | FileList) => Promise<void>
  deleteMedia: (noteId: string, media: NoteMedia) => Promise<void>
  copyMedia: (media: NoteMedia) => Promise<boolean>
  urlFor: (media: NoteMedia) => string | undefined
}

async function signPaths(paths: string[]): Promise<Record<string, string>> {
  if (paths.length === 0) return {}
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrls(paths, SIGNED_TTL)
  if (error || !data) {
    console.error('[media] createSignedUrls:', error?.message)
    return {}
  }
  const out: Record<string, string> = {}
  for (const row of data) {
    if (row.path && row.signedUrl) out[row.path] = row.signedUrl
  }
  return out
}

export const useMediaStore = create<MediaState>()((set, get) => ({
  mediaByNote: {},
  urlByPath: {},
  uploadingByNote: {},
  copyingId: null,

  loadMedia: async (noteId) => {
    const { data, error } = await supabase
      .from('note_media')
      .select('*')
      .eq('note_id', noteId)
      .order('created_at', { ascending: true })
    if (error) {
      console.error('[media] loadMedia:', error.message)
      return
    }
    const rows = (data ?? []) as NoteMedia[]
    const urls = await signPaths(rows.map((r) => r.storage_path))
    set((s) => ({
      mediaByNote: { ...s.mediaByNote, [noteId]: rows },
      urlByPath: { ...s.urlByPath, ...urls },
    }))
  },

  uploadFiles: async (noteId, files) => {
    const userId = useAuthStore.getState().user?.id
    if (!userId) return
    // Aceita QUALQUER tipo (vídeo/arquivo); só barra o que passa de 250MB (o bucket
    // rejeitaria de qualquer forma — pré-filtrar evita upload que falha no meio).
    const list = Array.from(files).filter((f) => {
      if (f.size > MAX_MEDIA_SIZE) { console.warn(`[media] "${f.name}" > 250MB — ignorado`); return false }
      return true
    })
    if (list.length === 0) return

    // Decrementa o contador de "em upload" — por item, pra a fileira de
    // placeholders refletir o que ainda falta (sem fantasmas no multi-upload).
    const dec = (count: number) =>
      set((s) => {
        const n = (s.uploadingByNote[noteId] ?? 0) - count
        const next = { ...s.uploadingByNote }
        if (n > 0) next[noteId] = n
        else delete next[noteId]
        return { uploadingByNote: next }
      })

    set((s) => ({ uploadingByNote: { ...s.uploadingByNote, [noteId]: (s.uploadingByNote[noteId] ?? 0) + list.length } }))
    let processed = 0
    try {
      for (const file of list) {
        try {
          const path = `${noteId}/${crypto.randomUUID()}.${extFor(file)}`
          const up = await supabase.storage.from(BUCKET).upload(path, file, {
            contentType: file.type || 'application/octet-stream',
            upsert: false,
          })
          if (up.error) {
            console.error('[media] upload:', up.error.message)
            continue
          }
          const ins = await supabase
            .from('note_media')
            .insert({
              note_id: noteId,
              storage_path: path,
              mime_type: file.type || 'application/octet-stream',
              filename: file.name || null,
              created_by: userId,
            })
            .select()
            .single()
          if (ins.error || !ins.data) {
            console.error('[media] insert note_media:', ins.error?.message)
            void supabase.storage.from(BUCKET).remove([path]) // desfaz órfão
            continue
          }
          const row = ins.data as NoteMedia
          const urls = await signPaths([path])
          set((s) => ({
            mediaByNote: { ...s.mediaByNote, [noteId]: [...(s.mediaByNote[noteId] ?? []), row] },
            urlByPath: { ...s.urlByPath, ...urls },
          }))
        } finally {
          processed += 1
          dec(1)
        }
      }
    } finally {
      if (processed < list.length) dec(list.length - processed) // segurança
    }
  },

  deleteMedia: async (noteId, media) => {
    const { error } = await supabase.from('note_media').delete().eq('id', media.id)
    if (error) {
      console.error('[media] deleteMedia:', error.message)
      return
    }
    void supabase.storage.from(BUCKET).remove([media.storage_path])
    set((s) => ({
      mediaByNote: {
        ...s.mediaByNote,
        [noteId]: (s.mediaByNote[noteId] ?? []).filter((m) => m.id !== media.id),
      },
    }))
  },

  copyMedia: async (media) => {
    set({ copyingId: media.id })
    try {
      // Re-assina SEMPRE na hora — a signed URL em cache pode ter expirado (TTL 2h)
      // se a nota ficou aberta. Atualiza o cache de quebra.
      const fresh = await signPaths([media.storage_path])
      const url = fresh[media.storage_path] ?? get().urlFor(media)
      if (fresh[media.storage_path]) {
        set((s) => ({ urlByPath: { ...s.urlByPath, ...fresh } }))
      }
      if (!url) return false
      const resp = await fetch(url)
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
      const blob = await resp.blob()
      await copyImageToClipboard(blob)
      return true
    } catch (err) {
      console.error('[media] copyMedia:', err)
      return false
    } finally {
      set({ copyingId: null })
    }
  },

  urlFor: (media) => get().urlByPath[media.storage_path],
}))
