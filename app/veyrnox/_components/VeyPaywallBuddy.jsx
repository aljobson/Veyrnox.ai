'use client';
import { motion, useReducedMotion } from 'motion/react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AMBIENT_HOP_MS, PEEK_MS, PEEK_ROTATE, PEEK_TIMES, PEEK_Y, paywallMoodFor } from '../../../lib/veyMotion';
import VeyCharacter from './VeyCharacter';

/**
 * The mood of the companion beside the credit packs. `notify` takes what the reader just did ('hover', 'select',
 * 'consent', 'checkout', 'error', 'leave'); a mood with a hold settles back to idle by itself. `welcome` is how Vey
 * greets the reader when the paywall opens ('welcomeFirst' for a new account, 'welcomeLow' for a low balance).
 */
export function useVeyPaywallMood(welcome = null) {
  const reduceMotion = useReducedMotion();
  const [mood, setMood] = useState('idle');
  const moodRef = useRef('idle');
  const timer = useRef(0);

  const change = useCallback((next) => {
    moodRef.current = next;
    setMood(next);
  }, []);

  const notify = useCallback((event) => {
    const { mood: next, holdMs } = paywallMoodFor(event);
    // Leaving a pack ends only the pointing; a cheer or a worry runs out its own time.
    if (event === 'leave') {
      if (moodRef.current === 'guiding') change('idle');
      return;
    }
    // A checkout in flight is not interrupted by a hover or an idle hop.
    if ((event === 'hover' || event === 'ambient') && moodRef.current === 'thinking') return;
    window.clearTimeout(timer.current);
    change(next);
    if (holdMs) timer.current = window.setTimeout(() => change('idle'), holdMs);
  }, [change]);

  useEffect(() => {
    if (welcome) notify(welcome);
    return () => window.clearTimeout(timer.current);
  }, [welcome, notify]);

  useEffect(() => {
    if (reduceMotion) return undefined;
    const id = window.setInterval(() => { if (moodRef.current === 'idle') notify('ambient'); }, AMBIENT_HOP_MS);
    return () => window.clearInterval(id);
  }, [reduceMotion, notify]);

  return { mood, notify };
}

// Vey beside the packs, standing on their top edge. It is decoration: the packs and the words carry the meaning,
// so it is hidden from assistive technology and takes no clicks, and it holds still for anyone who asked for less motion.
export function VeyPaywallBuddy({ mood }) {
  const reduceMotion = useReducedMotion();
  const peeking = mood === 'peek' && !reduceMotion;
  // Choosing a pack or plan: Vey climbs up from behind the card, peeks its head over the edge, looks around, then
  // climbs over and stands on top. Cropped at the card's top edge only (negative insets leave the other sides open),
  // so the hops and cheers above the edge are never clipped.
  return (
    <div
      aria-hidden="true"
      data-testid="paywall-vey"
      data-mood={mood}
      className="pointer-events-none -mb-[3px] flex justify-end pe-3 sm:pe-6"
      style={{ clipPath: 'inset(-300% -50% 0 -50%)' }}
    >
      <motion.div
        className="h-[72px] w-[69px] sm:h-[88px] sm:w-[84px]"
        initial={false}
        animate={peeking ? { y: PEEK_Y, rotate: PEEK_ROTATE } : { y: 0, rotate: 0 }}
        transition={peeking ? { duration: PEEK_MS / 1000, times: PEEK_TIMES, ease: 'easeInOut' } : { duration: 0.2 }}
        style={{ transformOrigin: '50% 100%' }}
      >
        <VeyCharacter pose={mood === 'peek' ? 'cheer' : mood} reducedMotion={reduceMotion} />
      </motion.div>
    </div>
  );
}
