-- ============================================================================
-- Mileto Notas — Mídias: aceitar VÍDEOS e ARQUIVOS (não só imagens)
-- ----------------------------------------------------------------------------
-- O bucket note-media (privado) só aceitava raster (png/jpeg/gif/webp/avif) e 25MB.
-- Passa a aceitar QUALQUER tipo (vídeo + arquivos) até 250MB. As POLICIES de acesso
-- (storage.objects) NÃO mudam — continuam gateadas por acesso à nota (pasta =
-- <note_id>/...) via notas_can_edit_note. A validação de tipo era só do bucket.
--
-- ⚠️ O usuário escolheu "qualquer arquivo" — inclui tipos executáveis. O front exibe
-- como download (não auto-executa). Tamanho 250MB ocupa disco na VPS compartilhada.
-- Só toca o BUCKET (config do Storage) — nenhum objeto do Ops afetado.
-- ============================================================================

update storage.buckets
set allowed_mime_types = null,          -- qualquer MIME
    file_size_limit    = 262144000      -- 250 MB (250 * 1024 * 1024)
where id = 'note-media';
