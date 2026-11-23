'use client';
import { useEffect, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import Link from 'next/link';
import { useI18n } from '../../../components/I18nProvider';
import { getSession, onSessionChange } from '../../lib/authClient';
import { GENERATION_SUCCEEDED_EVENT } from '../_lib/jobHistory';
import { createGenerationQueue } from '../_lib/generationQueue.mjs';
import { resultIsPresent } from '../_lib/resultPresence';
import { playCelebrationSound } from '../_lib/celebrationSound';
import { ConfettiBurst } from './ConfettiBurst';
import VeyCharacter from './VeyCharacter';
import { useReducedMotion } from 'motion/react';

export function GenerationCelebration() {
  const pathname = usePathname();
  const { t } = useI18n();
  const reduced = useReducedMotion();
  const [shown, setShown] = useState(null);
  const queueRef = useRef(null);
  const previousPath = useRef(pathname);
  useEffect(() => {
    const queue = createGenerationQueue({ show: setShown, isPresent: resultIsPresent });
    queueRef.current = queue;
    let owner = getSession()?.user?.id;
    const success = event => queue.push(event.detail);
    const off = onSessionChange(session => {
      const next = session?.user?.id;
      if (next !== owner) { owner = next; queue.clear(); }
    });
    window.addEventListener(GENERATION_SUCCEEDED_EVENT, success);
    return () => { queue.clear(); off(); window.removeEventListener(GENERATION_SUCCEEDED_EVENT, success); };
  }, []);
  useEffect(() => {
    if (previousPath.current !== pathname) queueRef.current?.dismiss();
    previousPath.current = pathname;
  }, [pathname]);
  useEffect(() => { if (shown?.job_id) playCelebrationSound(); }, [shown?.job_id]);
  // Fixed and pointer-transparent: the notice never changes the page layout.
  return <div className="vx-generation-notice" data-generation-celebration aria-live="polite" aria-atomic="true">
    {shown && <div key={shown.job_id} className="vx-celebrate-card">
      <ConfettiBurst />
      <span aria-hidden="true" className="vx-celebrate-mascot"><VeyCharacter pose="cheer" mood="happy" reducedMotion={reduced !== false} /></span>
      <p>{shown.count > 1 ? t('public.jobs.resultsReady', { count: shown.count }) : t('public.jobs.ready', { label: shown.label || t('public.jobs.default') })}
        {shown.credits > 0 && <span className="ms-3 whitespace-nowrap font-vx-mono text-vx-money">−{t('pricing.cards.credits', { credits: shown.credits })}</span>}</p>
      {shown.link && <Link href="/app/library" className="vx-celebrate-link">{t('public.vey.action.open_library')}</Link>}
    </div>}
  </div>;
}
