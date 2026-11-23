'use client';
// A one-off burst of confetti. Pure CSS, no layout effect, hidden from assistive technology and skipped for reduced motion.
const COLORS = ['--vx-accent', '--vx-money', '--vx-fg', '--vx-danger'];
const PIECES = Array.from({ length: 40 }, (_, i) => {
  const angle = (i / 40) * Math.PI * 2 + (i % 5) * 0.13;
  const radius = 140 + ((i * 37) % 160);
  return {
    dx: Math.round(Math.cos(angle) * radius),
    dy: Math.round(Math.sin(angle) * radius * 0.8 - 40),
    rot: ((i * 83) % 720) - 360,
    delay: (i % 8) * 25,
    color: COLORS[i % COLORS.length],
    w: 6 + (i % 3) * 2,
  };
});
export function ConfettiBurst() {
  return <div className="vx-confetti" aria-hidden="true" data-confetti>
    {PIECES.map((p, i) => <span key={i} className="vx-confetti-piece" style={{ '--dx': `${p.dx}px`, '--dy': `${p.dy}px`, '--rot': `${p.rot}deg`, animationDelay: `${p.delay}ms`, background: `rgb(var(${p.color}))`, width: p.w, height: p.w * 1.6 }} />)}
  </div>;
}
