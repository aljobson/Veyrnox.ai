'use client';
import { useEffect, useState } from 'react';
import { useReducedMotion } from 'motion/react';
import { useI18n } from '../../../components/I18nProvider';
import { GENERATION_SUCCEEDED_EVENT } from '../_lib/jobHistory';
import VeyCharacter from './VeyCharacter';

const SHOW_MS = 2800;
const PIECES = Array.from({ length: 16 }, (_, index) => ({
  x: `${Math.round(Math.cos((index / 16) * Math.PI * 2) * (90 + (index % 3) * 34))}px`,
  y: `${Math.round(Math.sin((index / 16) * Math.PI * 2) * (54 + (index % 4) * 20))}px`,
  delay: `${(index % 4) * 35}ms`,
  tone: ['var(--vx-accent)', 'var(--vx-money)', 'var(--vx-fg)'][index % 3],
}));

// One moment for every finished generation. It never takes focus or catches a tap: the result stays usable under it.
export function GenerationCelebration() {
  const { t } = useI18n();
  const reduced = useReducedMotion();
  const [shown, setShown] = useState(null);
  useEffect(() => {
    let timer = null;
    const onSuccess = event => {
      clearTimeout(timer);
      setShown({ id: event.detail?.job_id, label: event.detail?.label || t('public.jobs.default') });
      timer = setTimeout(() => setShown(null), SHOW_MS);
    };
    window.addEventListener(GENERATION_SUCCEEDED_EVENT, onSuccess);
    return () => { clearTimeout(timer); window.removeEventListener(GENERATION_SUCCEEDED_EVENT, onSuccess); };
  }, [t]);
  if (!shown) return null;
  return <div key={shown.id} className="pointer-events-none fixed inset-x-4 top-20 z-[90] flex justify-center" data-generation-celebration>
    <div className="vx-celebrate-card relative flex max-w-sm items-center gap-3 rounded-2xl border border-vx-accent bg-vx-panel px-4 py-3 text-vx-fg shadow-lg">
      {!reduced && <span aria-hidden="true" className="absolute start-1/2 top-1/2">{PIECES.map((piece, index) =>
        <i key={index} className="vx-celebrate-piece" style={{ '--vx-piece-x': piece.x, '--vx-piece-y': piece.y, animationDelay: piece.delay, background: piece.tone }} />)}</span>}
      <span aria-hidden="true" className="w-12 shrink-0 [&>svg]:drop-shadow-none"><VeyCharacter pose="cheer" mood="happy" reducedMotion={reduced !== false} /></span>
      <p role="status" className="line-clamp-2 min-w-0 font-bold">{t('public.jobs.ready', { label: shown.label })}</p>
    </div>
  </div>;
}
