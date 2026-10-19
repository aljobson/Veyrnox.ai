'use client';
import { useI18n } from '../../../components/I18nProvider';


import Image from 'next/image';
import { chip } from './oddlingStyles';
import { ODDLING_MOTIONS } from '../_lib/oddlingStudio';

// One column. Each preset's phrase sits under its name and wraps, so the whole
// phrase can be read without hovering; it is also the chip's description.
export function OddlingMotionPanel({ portrait, priceLine, motionId, onMotion }) {
  const { t } = useI18n();
  return (
    <section className="mt-5 rounded-2xl border border-vx-accent/30 bg-vx-accent/[0.04] p-4">
      {portrait && <><Image src={portrait.image} alt={t('app.oddlings.motion.frame', { name: portrait.name })} width={1024} height={1536} className="mx-auto mb-3 h-56 w-full object-contain" /><p className="mb-3 text-xs text-vx-fg-body">{t('app.oddlings.motion.photo', { name: portrait.name })}</p></>}
      <p className="mb-3 text-xs text-vx-accent">{priceLine}</p>
      <span className="font-vx-mono text-[9px] font-bold tracking-[0.12em] text-vx-accent">{t("app.oddlings.motion.title")}</span>
      <div className="mt-3 grid gap-2">
        {ODDLING_MOTIONS.map((motion) => (
          <div key={motion.id} className="min-w-0">
            <button type="button" onClick={() => onMotion(motion.id)} aria-pressed={motionId === motion.id} aria-describedby={`motion-phrase-${motion.id}`} className={`${chip(motionId === motion.id)} w-full text-start`}>{motion.name}</button>
            <p id={`motion-phrase-${motion.id}`} className="mt-1 break-words px-1 text-[10px] leading-snug text-vx-fg-faint">{motion.phrase}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
