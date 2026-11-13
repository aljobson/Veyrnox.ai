'use client';

import Image from 'next/image';
import { isDefaultMusicSampleMix, normalizeMusicSampleMix } from '../../../../lib/musicDiscover.js';

export function MusicSampleSeedCard({ seed, mix: rawMix, onRemove }) {
  if (!seed) return null;
  const mix = normalizeMusicSampleMix(rawMix);
  const shaped = rawMix && !isDefaultMusicSampleMix(mix);
  return (
    <section aria-label="Attached beat seed" className="overflow-hidden rounded-2xl border border-vx-border-boost bg-vx-base">
      <div className="flex items-center gap-3 p-3">
        <div className="relative h-16 w-16 shrink-0 overflow-hidden rounded-xl bg-vx-panel-raised">
          <Image src={seed.artwork} alt="" fill sizes="64px" className="object-cover" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="font-vx-mono text-[10px] font-bold uppercase tracking-widest text-vx-accent">Beat seed attached</p>
          <h3 className="mt-1 truncate font-vx text-lg font-black">{seed.title}</h3>
          <p className="truncate text-xs text-vx-fg-muted">{shaped ? `${Math.round(seed.bpm * mix.tempo)} BPM · ${Math.round(mix.tempo * 100)}% speed` : `${seed.bpm} BPM`} · {seed.musicalKey}</p>
        </div>
        <button type="button" onClick={onRemove} aria-label={`Remove ${seed.title} seed`} className="grid h-10 w-10 shrink-0 place-items-center rounded-full border border-vx-border text-lg font-bold text-vx-fg-muted hover:border-vx-danger hover:text-vx-danger">×</button>
      </div>
      {shaped ? <p className="border-t border-vx-border px-3 py-2 font-vx-mono text-[10px] font-bold text-vx-accent">Mix attached · drums {mix.drums}% · bass {mix.bass}% · melody {mix.melody}%</p> : null}
      <p className="border-t border-vx-border px-3 py-2 text-[11px] leading-4 text-vx-fg-faint">The preview recording is not copied. Its Veyrnox production recipe and mix directions shape a new, distinct instrumental.</p>
    </section>
  );
}
