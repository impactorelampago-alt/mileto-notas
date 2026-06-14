/**
 * Copia uma imagem (Blob) para a área de transferência do sistema.
 * O clipboard de imagem dos navegadores/Electron aceita de forma confiável
 * apenas `image/png`, então convertemos via canvas quando necessário.
 */
async function toPngBlob(blob: Blob): Promise<Blob> {
  if (blob.type === 'image/png') return blob
  const bitmap = await createImageBitmap(blob)
  const canvas = document.createElement('canvas')
  canvas.width = bitmap.width
  canvas.height = bitmap.height
  const ctx = canvas.getContext('2d')
  if (!ctx) return blob
  ctx.drawImage(bitmap, 0, 0)
  bitmap.close?.()
  return await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Falha ao converter imagem'))), 'image/png')
  })
}

export async function copyImageToClipboard(blob: Blob): Promise<void> {
  const png = await toPngBlob(blob)
  await navigator.clipboard.write([new ClipboardItem({ 'image/png': png })])
}
