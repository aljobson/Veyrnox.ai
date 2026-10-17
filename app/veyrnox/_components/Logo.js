import { cn } from '../../../lib/utils';
// Veyrnox.ai mark — filled aqua V glyph (SVG) with optional VEYRNOX.ai wordmark.
// Match set with the marketing prototype so both surfaces read as one brand.
export function Logo({ size = 30, wordmark = false, className = '' }) {
  return (
    <span className={cn('inline-flex items-center gap-2.5', className)}>
      <img
        src="/logo-mark.png"
        alt=""
        aria-hidden="true"
        width={size * 1.56}
        height={size}
        style={{ width: size * 1.56, height: size }}
        className="block object-contain"
      />
      {wordmark && (
        <span className="font-vx font-extrabold tracking-[-0.01em] text-[15px] leading-none">
          <span>VEYRNOX</span>
          <span className="text-vx-accent">.ai</span>
        </span>
      )}
    </span>
  );
}
