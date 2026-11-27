import Link from 'next/link';

const TYPES = [
  {
    key: 'track',
    href: '/app/music/create',
    label: 'Full track',
    description: 'Song or instrumental',
  },
  {
    key: 'sound-effect',
    href: '/app/music/sounds',
    label: 'Sound effect',
    description: 'Effect, ambience or loop',
  },
];

export function MusicCreationTypeNav({ active }) {
  return (
    <section aria-labelledby="music-creation-type" className="rounded-2xl border border-vx-border bg-vx-panel p-3 shadow-lg sm:p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="px-1">
          <p id="music-creation-type" className="font-vx-mono text-xs font-bold uppercase tracking-widest text-vx-accent">What are you creating?</p>
          <p className="mt-1 text-sm text-vx-fg-muted">Choose the right creation flow before shaping the result.</p>
        </div>
        <nav aria-label="Creation type" className="grid min-w-0 gap-2 sm:grid-cols-2">
          {TYPES.map((type) => {
            const selected = active === type.key;
            return (
              <Link
                key={type.key}
                href={type.href}
                aria-current={selected ? 'page' : undefined}
                className={`vx-press min-w-44 rounded-xl border px-4 py-3 ${selected ? 'border-vx-accent bg-vx-accent/10 text-vx-fg' : 'border-vx-border bg-vx-base text-vx-fg-body hover:border-vx-border-boost'}`}
              >
                <span className="block text-sm font-black">{type.label}</span>
                <span className="mt-0.5 block text-xs text-vx-fg-muted">{type.description}</span>
              </Link>
            );
          })}
        </nav>
      </div>
    </section>
  );
}
