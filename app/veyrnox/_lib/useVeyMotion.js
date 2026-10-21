'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  CHEER_MS, HOP_MS, nextScrollState, perchPlacement, perchSide, readingSection,
} from '../../../lib/veyMotion';

// Sections that opt in to Vey landing beside them carry this attribute.
const PERCH_SELECTOR = '[data-vey-perch]';

/**
 * Vey's own motion on a page: a hop as the reader scrolls, a landing in the gutter beside the section being read,
 * and a cheer when tapped. `paused` holds all of it still (the chat is open, Vey is being dragged or guiding, or the
 * reader asked for reduced motion), so nothing here fights a move the reader or the helper is making. `stationary`
 * (the chat is open) stops the hops and landings but still lets a tap cheer.
 *
 * Returns `reaction` ('hop', 'cheer' or null) for the character's pose, `landing` ({position, facing} or null) for where
 * it should stand, and `cheer()` for the tap.
 */
export default function useVeyMotion({ paused, stationary = false, rtl = false, pathname }) {
  const [reaction, setReaction] = useState(null);
  const [landing, setLanding] = useState(null);
  const timer = useRef(0);
  const pausedRef = useRef(paused);
  pausedRef.current = paused;
  const stationaryRef = useRef(stationary);
  stationaryRef.current = stationary;

  const react = useCallback((kind, ms) => {
    window.clearTimeout(timer.current);
    setReaction(kind);
    timer.current = window.setTimeout(() => setReaction(null), ms);
  }, []);

  useEffect(() => {
    let frame = 0;
    let scroll = { y: window.scrollY, travelled: 0, lastHopAt: -Infinity };
    let landed = null;
    let landings = 0;

    const sync = () => {
      frame = 0;
      if (pausedRef.current || stationaryRef.current) {
        scroll = { ...scroll, y: window.scrollY };
        return;
      }
      const viewport = { width: window.innerWidth, height: window.innerHeight };
      const step = nextScrollState(scroll, window.scrollY, performance.now());
      scroll = step.state;
      if (step.hop) react('hop', HOP_MS);

      const sections = [...document.querySelectorAll(PERCH_SELECTOR)].map((node) => {
        const { top, bottom, left, right, width, height } = node.getBoundingClientRect();
        return { id: node, top, bottom, rect: { top, bottom, left, right, width, height } };
      });
      const reading = readingSection(sections, viewport.height);
      if (reading === landed) return;
      landed = reading;
      if (!reading) {
        // Between sections Vey stays where it landed, until none of them is on screen any more.
        if (!sections.some((section) => section.bottom > 0 && section.top < viewport.height)) setLanding(null);
        return;
      }
      const target = sections.find((section) => section.id === reading);
      const placement = perchPlacement({ rect: target.rect, viewport, side: perchSide(landings), rtl });
      landings += 1;
      if (placement) {
        setLanding(placement);
        react('hop', HOP_MS);
      } else {
        setLanding(null);
      }
    };
    const onScroll = () => { if (!frame) frame = requestAnimationFrame(sync); };

    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
      cancelAnimationFrame(frame);
      window.clearTimeout(timer.current);
      setLanding(null);
    };
  }, [pathname, react, rtl]);

  useEffect(() => {
    if (paused) {
      window.clearTimeout(timer.current);
      setReaction(null);
    }
  }, [paused]);

  const cheer = useCallback(() => {
    if (!pausedRef.current) react('cheer', CHEER_MS);
  }, [react]);

  return { reaction, landing: paused || stationary ? null : landing, cheer };
}
