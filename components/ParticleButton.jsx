'use client';

// Ported from 21st.dev @kokonutd/particle-button. framer-motion, lucide and
// shadcn Button swapped for a CSS keyframe (globals.css .vx-particle) and an
// inline icon, so it adds no dependencies.

import { useRef, useState } from 'react';

const PARTICLE_COUNT = 6;

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
  className = '',
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
        className={`relative inline-flex items-center gap-2 rounded-full bg-vx-accent px-4 py-2 text-[13px] font-bold text-vx-accent-ink transition-transform duration-100 hover:bg-vx-accent-hover disabled:opacity-60 ${burst ? 'scale-95' : ''} ${className}`}
        {...props}
      >
        {children}
        <svg
          aria-hidden="true"
          viewBox="0 0 24 24"
          className="h-4 w-4"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M14 4.1 12 6" />
          <path d="m5.1 8-2.9-.8" />
          <path d="m6 12-1.9 2" />
          <path d="M7.2 2.2 8 5.1" />
          <path d="M9.037 9.69a.498.498 0 0 1 .653-.653l11 4.5a.5.5 0 0 1-.074.949l-4.349 1.041a1 1 0 0 0-.74.739l-1.04 4.35a.5.5 0 0 1-.95.074z" />
        </svg>
      </button>
    </>
  );
}
