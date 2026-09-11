// Veyrnox.ai mark — filled aqua V glyph (SVG) with optional VEYRNOX.ai wordmark.
// Match set with the marketing prototype so both surfaces read as one brand.
export function Logo({ size = 30, wordmark = false, className = '' }) {
  return (
    <span className={`inline-flex items-center gap-2.5 ${className}`}>
      <svg
        viewBox="0 0 120 120"
        xmlns="http://www.w3.org/2000/svg"
        aria-hidden="true"
        style={{ width: size, height: size, display: 'block' }}
      >
        <path d="M8 12 L38 12 L60 62 L82 12 L112 12 L60 112 Z" fill="#3EE6C4" />
      </svg>
      {wordmark && (
        <span className="font-vx font-extrabold tracking-[-0.01em] text-[15px] leading-none">
          <span>VEYRNOX</span>
          <span className="text-vx-accent">.ai</span>
        </span>
      )}
    </span>
  );
}
