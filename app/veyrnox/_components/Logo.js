// Veyrnox.ai mark — V glyph on aqua tile.
export function Logo({ size = 30 }) {
  return (
    <div
      className="rounded-[9px] bg-muon-accent flex items-center justify-center font-muon font-black text-muon-accent-ink"
      style={{ width: size, height: size, fontSize: Math.round(size * 0.55), letterSpacing: '-0.06em' }}
    >
      V
    </div>
  );
}
