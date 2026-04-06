export default function StatusBar() {
  return (
    <div
      className="flex h-7 shrink-0 items-center justify-between bg-zinc-900 px-4"
      style={{ boxShadow: '0 -1px 0 0 rgba(16, 185, 129, 0.2)' }}
    >
      <span className="text-xs text-zinc-500">Ln 1, Col 1</span>
      <span className="text-xs text-zinc-500">0 caracteres</span>
      <div className="flex items-center gap-1">
        <span className="text-xs text-zinc-500">UTF-8</span>
        <span className="text-xs text-zinc-700">·</span>
        <span className="text-xs text-zinc-500">Quebra automática: On</span>
      </div>
    </div>
  )
}
