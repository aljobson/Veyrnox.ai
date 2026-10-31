// A thin accent arc on a faint track. Decorative: the caller announces the
// wait in words (a role="status" line or aria-busy), so this is aria-hidden.
// Reduced motion swaps the spin for a slow fade.
export function Spinner({ size = 20, stroke = 2.5, className = '' }) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  return (
    <svg
      aria-hidden="true"
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      className={`shrink-0 animate-spin [animation-duration:900ms] motion-reduce:animate-pulse ${className}`}
    >
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="currentColor" strokeOpacity="0.18" strokeWidth={stroke} />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke="currentColor"
        strokeWidth={stroke}
        strokeLinecap="round"
        strokeDasharray={`${c * 0.28} ${c}`}
      />
    </svg>
  );
}
