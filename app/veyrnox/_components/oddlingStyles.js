// Class strings shared by the Oddling Studio pieces.
export const chip = (on) => `rounded-full border px-3 py-1.5 font-vx-mono text-[10px] font-bold transition-colors ${
  on ? 'border-vx-accent bg-vx-accent/[0.09] text-vx-accent' : 'border-vx-border bg-vx-base text-vx-fg-muted hover:border-vx-fg/30 hover:text-vx-fg'
}`;

export const field = 'w-full rounded-xl border border-vx-field bg-vx-base px-3 py-2.5 text-sm text-vx-fg placeholder:text-vx-fg-faint focus:border-vx-accent focus:outline-hidden';

// From sm up the five portraits fan out, the middle one largest; below that they stay a plain row of three.
export const HERO_FAN = [
  'sm:w-28 sm:translate-y-4 sm:-rotate-6 lg:w-36',
  'sm:-ms-5 sm:w-32 sm:translate-y-2 sm:-rotate-3 lg:w-40',
  'sm:-ms-5 sm:z-10 sm:w-36 lg:w-48',
  'sm:-ms-5 sm:w-32 sm:translate-y-2 sm:rotate-3 lg:w-40',
  'sm:-ms-5 sm:w-28 sm:translate-y-4 sm:rotate-6 lg:w-36',
];
