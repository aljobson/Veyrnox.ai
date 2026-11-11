'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import { useI18n } from '../../../components/I18nProvider.jsx';
import { getStoredUserId, onSessionChange } from '../../lib/authClient';
import { addSeen, findVisible, isBlocked, parseSeen, seenKey, tourForPath, TOUR_REPLAY_EVENT } from '../../../lib/featureTours.js';

const FIND_ATTEMPTS = 25;
const FIND_INTERVAL_MS = 200;
const btn = 'min-h-11 rounded-full px-4 py-2 text-xs font-bold focus-visible:outline-2 focus-visible:outline-vx-accent sm:min-h-0';

function readSeen(userId) {
  try { return parseSeen(localStorage.getItem(seenKey(userId))); } catch { return []; }
}
function writeSeen(userId, id) {
  try { localStorage.setItem(seenKey(userId), JSON.stringify(addSeen(readSeen(userId), id))); } catch { /* storage blocked: the tour may show again */ }
}

/**
 * @typedef {{ selector: string, title: string, message: string, optional?: boolean }} TourStep
 * @typedef {{ id: string, name: string, route: string, steps: TourStep[] }} Tour
 * @typedef {{ tour: Tour, steps: TourStep[] }} TourRun
 * @typedef {{ top: number, left: number, width: number, height: number }} TourBox
 */

function useSessionUserId() {
  const [userId, setUserId] = useState(null);
  useEffect(() => {
    setUserId(getStoredUserId());
    return onSessionChange(() => setUserId(getStoredUserId()));
  }, []);
  return userId;
}

// Bumps a counter when something asks to replay this page's tour (clears its seen mark first).
function useReplayRequest(pathname, userId) {
  const [replay, setReplay] = useState(0);
  useEffect(() => {
    const again = () => {
      const tour = tourForPath(pathname);
      if (tour && userId) {
        try { localStorage.setItem(seenKey(userId), JSON.stringify(readSeen(userId).filter((id) => id !== tour.id))); } catch { /* ignore */ }
      }
      setReplay((n) => n + 1);
    };
    window.addEventListener(TOUR_REPLAY_EVENT, again);
    return () => window.removeEventListener(TOUR_REPLAY_EVENT, again);
  }, [pathname, userId]);
  return replay;
}

// Wait for the page to render its controls, then keep only the steps that exist.
// Waiting behind a modal or walkthrough does not spend the retry budget.
function useTourDiscovery(pathname, userId, replay, onReset, onReady) {
  useEffect(() => {
    onReset();
    const tour = tourForPath(pathname);
    if (!tour || !userId || readSeen(userId).includes(tour.id)) return undefined;
    const required = tour.steps.filter((step) => !step.optional).length;
    let attempt = 0;
    let timer;
    const look = () => {
      if (isBlocked(document)) { timer = setTimeout(look, FIND_INTERVAL_MS); return; }
      const steps = tour.steps.filter((step) => findVisible(document, step.selector));
      const ready = steps.length > 0 && (steps.length >= required || attempt >= FIND_ATTEMPTS - 1);
      if (ready) { onReady({ tour, steps }); return; }
      if (++attempt < FIND_ATTEMPTS) timer = setTimeout(look, FIND_INTERVAL_MS);
    };
    timer = setTimeout(look, FIND_INTERVAL_MS);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- onReset/onReady are stable setters wrappers
  }, [pathname, userId, replay]);
}

// Hide while a modal or walkthrough is open; drop steps whose control has gone.
function useTourGuard(run, index, setRun, setIndex) {
  const [paused, setPaused] = useState(false);
  useEffect(() => {
    if (!run) return undefined;
    const tick = () => {
      const blocked = isBlocked(document);
      setPaused(blocked);
      if (blocked) return;
      const kept = run.steps.filter((s) => findVisible(document, s.selector));
      if (kept.length === run.steps.length) return;
      if (!kept.length) { setRun(null); return; }
      const at = kept.indexOf(run.steps[index]);
      setRun({ ...run, steps: kept });
      setIndex(at >= 0 ? at : Math.min(index, kept.length - 1));
    };
    const id = setInterval(tick, 400);
    return () => clearInterval(id);
  }, [run, index, setRun, setIndex]);
  return paused;
}

// Follow the target through scroll and resize.
function useTargetBox(step) {
  const [box, setBox] = useState(/** @type {TourBox | null} */ (null));
  useEffect(() => {
    if (!step) { setBox(null); return undefined; }
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
  return box;
}

function useEscapeToFinish(active, finish) {
  useEffect(() => {
    if (!active) return undefined;
    const onKey = (event) => { if (event.key === 'Escape' && !isBlocked(document)) finish(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [active, finish]);
}

// First-runner tour: points at the controls of the feature just opened, once per person.
// It never clicks, types or submits; the highlighted control stays usable.
export default function FeatureTour() {
  const { t } = useI18n();
  const pathname = usePathname();
  const userId = useSessionUserId();
  const replay = useReplayRequest(pathname, userId);
  const [run, setRun] = useState(/** @type {TourRun | null} */ (null));
  const [index, setIndex] = useState(0);
  const nextRef = useRef(null);
  const reset = useCallback(() => { setRun(null); setIndex(0); }, []);
  useTourDiscovery(pathname, userId, replay, reset, setRun);
  const step = run?.steps[index];
  const paused = useTourGuard(run, index, setRun, setIndex);
  const box = useTargetBox(paused ? null : step);
  const finish = useCallback(() => {
    if (run && userId) writeSeen(userId, run.tour.id);
    setRun(null);
  }, [run, userId]);
  useEscapeToFinish(Boolean(run), finish);
  // Focus the primary button on each step and again when the tour returns from a pause.
  useEffect(() => { if (!paused) nextRef.current?.focus({ preventScroll: true }); }, [step, paused]);

  if (!run || !step || paused) return null;
  const last = index === run.steps.length - 1;
  const { title, message } = step;
  return <>
    {box && <div aria-hidden="true" data-feature-tour-ring className="pointer-events-none fixed z-[70] rounded-xl border-2 border-vx-accent shadow-[0_0_0_9999px_rgba(0,0,0,0.45)]" style={box} />}
    <section role="dialog" aria-modal="false" aria-label={t('app.tours.label')} data-feature-tour className="pointer-events-none fixed inset-x-3 bottom-[max(12px,env(safe-area-inset-bottom))] z-[71] rounded-xl border border-vx-accent/40 bg-vx-panel p-4 shadow-2xl sm:inset-x-auto sm:end-4 sm:bottom-4 sm:w-[340px]">
      <p className="font-vx-mono text-[10px] font-bold uppercase tracking-wide text-vx-accent">{t('app.tours.progress', { name: run.tour.name, n: index + 1, total: run.steps.length })}</p>
      <h3 className="mt-1 text-base font-bold">{title}</h3>
      <p role="status" className="mt-2 text-sm leading-6 text-vx-fg-body">{message}</p>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button ref={nextRef} type="button" className={`${btn} pointer-events-auto bg-vx-accent text-vx-accent-ink`} onClick={() => (last ? finish() : setIndex(index + 1))}>{last ? t('app.tours.done') : t('app.tours.next')}</button>
        {index > 0 && <button type="button" className={`${btn} pointer-events-auto border border-vx-border`} onClick={() => setIndex(index - 1)}>{t('app.tours.back')}</button>}
        {!last && <button type="button" className={`${btn} pointer-events-auto text-vx-fg-muted`} onClick={finish}>{t('app.tours.skip')}</button>}
      </div>
    </section>
  </>;
}
