'use client';

// Ported from 21st.dev @kokonutd/particle-button. framer-motion, lucide and
// shadcn Button swapped for a CSS keyframe (globals.css .vx-particle) and
// caller-supplied content, so it adds no dependencies.

import { useRef, useState } from 'react';

const PARTICLE_COUNT = 6;
// No tailwind-merge here, so a caller's className replaces this whole string
// rather than being appended to it.
const DEFAULT_CLASS =
  'inline-flex items-center gap-2 rounded-full bg-vx-accent px-4 py-2 text-[13px] font-bold text-vx-accent-ink hover:bg-vx-accent-hover disabled:opacity-60';

function makeParticles() {
  return Array.from({ length: PARTICLE_COUNT }, (_, i) => ({
    dx: (i % 2 ? 1 : -1) * (Math.random() * 50 + 20),
    dy: -(Math.random() * 50 + 20),
  }));
}

export function ParticleButton({
  children,
  onClick,
  onSuccess,
  successDuration = 1000,
  className = DEFAULT_CLASS,
  ...props
}) {
  const [burst, setBurst] = useState(null);
  const buttonRef = useRef(null);

  const handleClick = (e) => {
    const rect = buttonRef.current.getBoundingClientRect();
    setBurst({
      x: rect.left + rect.width / 2,
      y: rect.top + rect.height / 2,
      particles: makeParticles(),
    });
    setTimeout(() => {
      setBurst(null);
      onSuccess?.();
    }, successDuration);
    onClick?.(e);
  };

  return (
    <>
      {burst &&
        burst.particles.map((p, i) => (
          <span
            key={i}
            aria-hidden="true"
            className="vx-particle pointer-events-none fixed h-1 w-1 rounded-full bg-vx-fg"
            style={{
              left: burst.x,
              top: burst.y,
              '--dx': `${p.dx}px`,
              '--dy': `${p.dy}px`,
              animationDelay: `${i * 0.1}s`,
            }}
          />
        ))}
      <button
        ref={buttonRef}
        type="button"
        onClick={handleClick}
        className={`relative transition-transform duration-100 ${burst ? 'scale-95' : ''} ${className}`}
        {...props}
      >
        {children}
      </button>
    </>
  );
}
