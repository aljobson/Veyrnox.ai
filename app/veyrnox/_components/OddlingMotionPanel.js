'use client';

import Image from 'next/image';
import { chip } from './oddlingStyles';
import { ODDLING_MOTIONS } from '../_lib/oddlingStudio';

// One column, so each preset's phrase has room to read as a single line under
// its name; the full phrase is also the caption's title and the chip's description.
export function OddlingMotionPanel({ portrait, priceLine, motionId, onMotion }) {
  return (
    <section className="mt-5 rounded-2xl border border-vx-accent/30 bg-vx-accent/[0.04] p-4">
      {portrait && <><Image src={portrait.image} alt={`${portrait.name} animation start frame`} width={1024} height={1536} className="mx-auto mb-3 h-56 w-full object-contain" /><p className="mb-3 text-xs text-vx-fg-body">Animating {portrait.name}&apos;s photo. To change the outfit or body, generate a new portrait first.</p></>}
      <p className="mb-3 text-xs text-vx-accent">{priceLine}</p>
      <span className="font-vx-mono text-[9px] font-bold tracking-[0.12em] text-vx-accent">MOTION PRESET</span>
      <div className="mt-3 grid gap-2">
        {ODDLING_MOTIONS.map((motion) => (
          <div key={motion.id} className="min-w-0">
            <button type="button" onClick={() => onMotion(motion.id)} aria-pressed={motionId === motion.id} aria-describedby={`motion-phrase-${motion.id}`} className={`${chip(motionId === motion.id)} w-full text-left`}>{motion.name}</button>
            <p id={`motion-phrase-${motion.id}`} title={motion.phrase} className="mt-1 truncate px-1 text-[10px] leading-snug text-vx-fg-faint">{motion.phrase}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
