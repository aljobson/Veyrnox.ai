'use client';
import { useEffect, useRef, useState } from 'react';
import { handForPoint, pointerPlacement } from '../../../lib/veyPointer';
import { mobileClearance, mobileDockPosition } from '../../../lib/veyMobileLayout';

const PANEL = '[aria-label="Vey task walkthrough"], [role="dialog"][aria-labelledby="vx-helper-title"]';

export default function useVeyMobileLayout({ open, pathname, position, highlight, hand, facing, pointRequest, activeTarget }) {
  const [layout, setLayout] = useState(null);
  const latest = useRef({ highlight, facing, activeTarget });
  const refresh = useRef(null);
  const cue = useRef(null);
  useEffect(() => { latest.current = { highlight, facing, activeTarget }; refresh.current?.(); }, [highlight, facing, activeTarget]);
  useEffect(() => {
    cue.current = pointRequest ? { target: pointRequest.id, position: null } : null;
    refresh.current?.();
    const timer = setTimeout(() => { cue.current = null; refresh.current?.(); }, 2600);
    return () => clearTimeout(timer);
  }, [pointRequest]);
  useEffect(() => {
    let frame, main, original, base, applied, panel;
    const root = document.documentElement;
    const originalScrollPadding = root.style.scrollPaddingBottom;
    let appliedScrollPadding;
    const restore = () => { if (main && main.style.paddingBottom === applied) main.style.paddingBottom = original; };
    const resize = new ResizeObserver(() => schedule());
    const measure = () => {
      const { highlight, facing, activeTarget } = latest.current;
      const current = document.querySelector('main');
      if (main !== current) {
        restore(); main = current; original = main?.style.paddingBottom || '';
        base = main ? parseFloat(getComputedStyle(main).paddingBottom) || 0 : 0;
      }
      const editorDock = document.querySelector('[aria-label="Mobile editor sections"]');
      const nextPanel = open ? document.querySelector(PANEL) : document.querySelector('[aria-label="Browser storage notice"]')
        || (editorDock?.getBoundingClientRect().height > 0 ? editorDock : null);
      if (panel !== nextPanel) { resize.disconnect(); panel = nextPanel; if (panel) resize.observe(panel); }
      const viewport = { width: innerWidth, height: innerHeight };
      const dock = panel?.getBoundingClientRect();
      const clearance = mobileClearance(base || 0, viewport, dock);
      applied = open && dock && viewport.width < 640 ? `${clearance}px` : original;
      if (main && main.style.paddingBottom !== applied) main.style.paddingBottom = applied;
      appliedScrollPadding = open && dock && viewport.width < 640 ? `${clearance}px` : originalScrollPadding;
      if (root.style.scrollPaddingBottom !== appliedScrollPadding) root.style.scrollPaddingBottom = appliedScrollPadding;
      if (viewport.width >= 640) { setLayout(null); return; }
      const pointing = open && dock && cue.current?.target === activeTarget && highlight && highlight.bottom > 72 && highlight.top < viewport.height;
      if (!pointing && cue.current?.position) cue.current = null;
      // One deliberate Show action gets one destination, not a moving search
      // for gaps. Its short pointing gesture then returns to the stable dock.
      if (pointing && !cue.current.position) cue.current.position = pointerPlacement(highlight, viewport, dock).position;
      const fixed = pointing && cue.current.position;
      const safe = fixed || mobileDockPosition(viewport, dock, panel?.matches('[aria-label="Vey task walkthrough"]'));
      const next = { position: safe, docked: !fixed, hand: fixed ? handForPoint(safe, facing, pointerPlacement(highlight, viewport, null, safe).point) : undefined };
      setLayout(previous => JSON.stringify(previous) === JSON.stringify(next) ? previous : next);
    };
    const schedule = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(measure); };
    refresh.current = schedule;
    const mutation = new MutationObserver(schedule);
    mutation.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['class', 'aria-expanded', 'aria-pressed'] });
    window.addEventListener('resize', schedule);
    window.visualViewport?.addEventListener('resize', schedule);
    schedule();
    return () => {
      cancelAnimationFrame(frame); resize.disconnect(); mutation.disconnect(); restore();
      if (root.style.scrollPaddingBottom === appliedScrollPadding) root.style.scrollPaddingBottom = originalScrollPadding;
      refresh.current = null;
      window.removeEventListener('resize', schedule);
      window.visualViewport?.removeEventListener('resize', schedule);
    };
  }, [open, pathname]);
  return layout || { position, hand };
}
