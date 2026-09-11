// Muon mark — μ glyph on aqua tile.
export function Logo({ size = 30 }) {
  return (
    <div
      className="rounded-[9px] bg-muon-accent flex items-center justify-center font-muon-mono font-extrabold text-muon-accent-ink"
      style={{ width: size, height: size, fontSize: Math.round(size * 0.5) }}
    >
      μ
    </div>
  );
}
