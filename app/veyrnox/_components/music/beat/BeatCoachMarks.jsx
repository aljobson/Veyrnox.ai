'use client';
import { useEffect, useRef, useState } from 'react';
import BeatCoachTip from './BeatCoachTip';
import { getStoredUserId, onSessionChange } from '../../../../lib/authClient.js';
import { beatTipsBlocked, createBeatTipSession } from '../../../_lib/music/beat/beatCoachMarks.mjs';

export default function BeatCoachMarks({ replay = 0 }) {
  const [step, setStep] = useState(null), [userId, setUserId] = useState(null);
  const primary = useRef(null), session = useRef(null);
  useEffect(() => {
    const changed = () => setUserId(getStoredUserId());
    changed(); return onSessionChange(changed);
  }, []);
  useEffect(() => {
    let storage, frame;
    try { storage = window.localStorage; } catch { /* Storage is optional. */ }
    const current = createBeatTipSession({ doc: document, viewport: () => ({ width: innerWidth, height: innerHeight }), storage, userId, replay: replay > 0,
      show: value => setStep(previous => value && previous?.index === value.index && ['top', 'left', 'width', 'height'].every(key => previous.box[key] === value.box[key]) ? previous : value),
      focusPrimary: () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(() => { if (!beatTipsBlocked(document)) primary.current?.focus({ preventScroll: true }); }); },
    });
    session.current = current;
    const update = () => current.update(), key = event => current.escape(event);
    // Poll also covers visibility changes from stylesheets, transitions and media queries.
    const timer = setInterval(update, 200), observer = new MutationObserver(update);
    observer.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['open', 'hidden', 'aria-modal', 'style', 'class'] });
    window.addEventListener('keydown', key); window.addEventListener('resize', update); window.addEventListener('scroll', update, true);
    update();
    return () => { clearInterval(timer); cancelAnimationFrame(frame); observer.disconnect(); window.removeEventListener('keydown', key); window.removeEventListener('resize', update); window.removeEventListener('scroll', update, true); current.dispose(); };
  }, [userId, replay]);
  if (!step) return null;
  return <BeatCoachTip step={step} primary={primary} onNext={() => session.current.next()} onSkip={() => session.current.skip()} />;
}
