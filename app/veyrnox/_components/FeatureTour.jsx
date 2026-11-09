'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import { tOr } from '../../../lib/i18n/translate.mjs';
import { useI18n } from '../../../components/I18nProvider.jsx';
import { getStoredUserId, onSessionChange } from '../../lib/authClient';
import { addSeen, findVisible, parseSeen, seenKey, tourForPath, TOUR_REPLAY_EVENT } from '../../../lib/featureTours.js';

const FIND_ATTEMPTS = 25;
const FIND_INTERVAL_MS = 200;
const btn = 'min-h-11 rounded-full px-4 py-2 text-xs font-bold focus-visible:outline-2 focus-visible:outline-vx-accent sm:min-h-0';

function readSeen(userId) {
  try { return parseSeen(localStorage.getItem(seenKey(userId))); } catch { return []; }
}
function writeSeen(userId, id) {
  try { localStorage.setItem(seenKey(userId), JSON.stringify(addSeen(readSeen(userId), id))); } catch { /* storage blocked: the tour may show again */ }
}

// First-runner tour: points at the controls of the feature just opened, once per person.
// It never clicks, types or submits; the highlighted control stays usable.
export default function FeatureTour() {
  const { t } = useI18n();
  const pathname = usePathname();
  const [userId, setUserId] = useState(null);
  const [run, setRun] = useState(null); // { tour, steps: [{...step, index}] }
  const [index, setIndex] = useState(0);
  const [box, setBox] = useState(null);
  const [replay, setReplay] = useState(0);
  const nextRef = useRef(null);

  useEffect(() => {
    setUserId(getStoredUserId());
    return onSessionChange(() => setUserId(getStoredUserId()));
  }, []);

  useEffect(() => {
    const again = () => { const tour = tourForPath(pathname); if (tour && userId) { try { const seen = readSeen(userId).filter((id) => id !== tour.id); localStorage.setItem(seenKey(userId), JSON.stringify(seen)); } catch { /* ignore */ } } setReplay((n) => n + 1); };
    window.addEventListener(TOUR_REPLAY_EVENT, again);
    return () => window.removeEventListener(TOUR_REPLAY_EVENT, again);
  }, [pathname, userId]);

  // Wait for the page to render its controls, then keep only the steps that exist.
  useEffect(() => {
    setRun(null); setIndex(0); setBox(null);
    const tour = tourForPath(pathname);
    if (!tour || !userId || readSeen(userId).includes(tour.id)) return undefined;
    let attempt = 0;
    let timer;
    const look = () => {
      const blocked = document.querySelector('[role="dialog"][aria-modal="true"], [data-vey-walkthrough]');
      const steps = blocked ? [] : tour.steps.filter((step) => findVisible(document, step.selector));
      const required = tour.steps.filter((step) => !step.optional).length;
      const ready = steps.length > 0 && (steps.length >= required || attempt >= FIND_ATTEMPTS - 1);
      if (ready) { setRun({ tour, steps }); return; }
      if (++attempt < FIND_ATTEMPTS) timer = setTimeout(look, FIND_INTERVAL_MS);
    };
    timer = setTimeout(look, FIND_INTERVAL_MS);
    return () => clearTimeout(timer);
  }, [pathname, userId, replay]);

  const step = run?.steps[index];

  const finish = useCallback(() => {
    if (run && userId) writeSeen(userId, run.tour.id);
    setRun(null); setBox(null);
  }, [run, userId]);

  // Follow the target through scroll and resize.
  useEffect(() => {
    if (!step) return undefined;
    const element = findVisible(document, step.selector);
    if (!element) { setBox(null); return undefined; }
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    element.scrollIntoView({ block: 'center', behavior: reduce ? 'auto' : 'smooth' });
    let frame;
    const measure = () => {
      const r = element.getBoundingClientRect();
      setBox({ top: r.top - 6, left: r.left - 6, width: r.width + 12, height: r.height + 12 });
    };
    const schedule = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(measure); };
    schedule();
    window.addEventListener('scroll', schedule, true);
    window.addEventListener('resize', schedule);
    const poll = setInterval(schedule, 400);
    return () => { cancelAnimationFrame(frame); clearInterval(poll); window.removeEventListener('scroll', schedule, true); window.removeEventListener('resize', schedule); };
  }, [step]);

  useEffect(() => { nextRef.current?.focus({ preventScroll: true }); }, [step]);

  useEffect(() => {
    if (!run) return undefined;
    const onKey = (event) => { if (event.key === 'Escape') finish(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [run, finish]);

  if (!run || !step) return null;
  const last = index === run.steps.length - 1;
  const key = `tours.${run.tour.id}.${step.selector.length}.${index}`;
  const title = tOr(t, `${key}.title`, step.title);
  const message = tOr(t, `${key}.message`, step.message);
  return <>
    {box && <div aria-hidden="true" data-feature-tour-ring className="pointer-events-none fixed z-[70] rounded-xl border-2 border-vx-accent shadow-[0_0_0_9999px_rgba(0,0,0,0.45)] transition-all duration-200 motion-reduce:transition-none" style={box} />}
    <section role="dialog" aria-modal="false" aria-label={tOr(t, 'tours.label', 'Feature tour')} data-feature-tour className="fixed inset-x-3 bottom-[max(12px,env(safe-area-inset-bottom))] z-[71] rounded-xl border border-vx-accent/40 bg-vx-panel p-4 shadow-2xl sm:inset-x-auto sm:end-4 sm:bottom-4 sm:w-[340px]">
      <p className="font-vx-mono text-[10px] font-bold uppercase tracking-wide text-vx-accent">{tOr(t, 'tours.progress', '{name} tour · {n} of {total}', { name: run.tour.name, n: index + 1, total: run.steps.length })}</p>
      <h3 className="mt-1 text-base font-bold">{title}</h3>
      <p role="status" className="mt-2 text-sm leading-6 text-vx-fg-body">{message}</p>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button ref={nextRef} type="button" className={`${btn} bg-vx-accent text-vx-accent-ink`} onClick={() => (last ? finish() : setIndex(index + 1))}>{last ? tOr(t, 'tours.done', 'Done') : tOr(t, 'tours.next', 'Next')}</button>
        {index > 0 && <button type="button" className={`${btn} border border-vx-border`} onClick={() => setIndex(index - 1)}>{tOr(t, 'tours.back', 'Back')}</button>}
        {!last && <button type="button" className={`${btn} text-vx-fg-muted`} onClick={finish}>{tOr(t, 'tours.skip', 'Skip tour')}</button>}
      </div>
    </section>
  </>;
}
