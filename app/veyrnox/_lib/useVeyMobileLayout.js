'use client';
import { useEffect, useRef, useState } from 'react';
import { handForPoint, pointerPlacement } from '../../../lib/veyPointer';
import { mobileClearance, safeMobilePosition } from '../../../lib/veyMobileLayout';

const PANEL = '[aria-label="Vey task walkthrough"], [role="dialog"][aria-labelledby="vx-helper-title"]';
const CONTROLS = 'main button, main input, main textarea, main select, main a, main summary, main img';

export default function useVeyMobileLayout({ open, pathname, position, highlight, hand, facing }) {
  const [layout, setLayout] = useState(null);
  const latest = useRef({ position, highlight, facing });
  const refresh = useRef(null);
  useEffect(() => { latest.current = { position, highlight, facing }; refresh.current?.(); }, [position, highlight, facing]);
  useEffect(() => {
    let frame, main, original, base, applied, panel;
    const restore = () => { if (main && main.style.paddingBottom === applied) main.style.paddingBottom = original; };
    const resize = new ResizeObserver(() => schedule());
    const measure = () => {
      const { position, highlight, facing } = latest.current;
      const current = document.querySelector('main');
      if (main !== current) {
        restore(); main = current; original = main?.style.paddingBottom || '';
        base = main ? parseFloat(getComputedStyle(main).paddingBottom) || 0 : 0;
      }
      const nextPanel = open ? document.querySelector(PANEL) : null;
      if (panel !== nextPanel) { resize.disconnect(); panel = nextPanel; if (panel) resize.observe(panel); }
      const viewport = { width: innerWidth, height: innerHeight };
      const dock = panel?.getBoundingClientRect();
      const clearance = mobileClearance(base || 0, viewport, dock);
      applied = open && dock && viewport.width < 640 ? `${clearance}px` : original;
      if (main && main.style.paddingBottom !== applied) main.style.paddingBottom = applied;
      if (viewport.width >= 640) { setLayout(null); return; }
      const obstacles = [...document.querySelectorAll(CONTROLS)].map(el => el.getBoundingClientRect())
        .filter(r => r.width > 0 && r.height > 0 && r.bottom > 72 && r.top < viewport.height);
      if (dock) obstacles.push(dock);
      // Also avoid fixed product controls outside main, but not Vey's own launcher.
      for (const el of document.querySelectorAll('button, a, input')) {
        if (el.closest('main, [data-testid="assistant-mascot"]') || panel?.contains(el)) continue;
        const r = el.getBoundingClientRect();
        if (r.width && r.height && r.bottom > 72 && r.top < viewport.height) obstacles.push(r);
      }
      const safe = safeMobilePosition(position, viewport, obstacles);
      const pointing = highlight && highlight.bottom > 72 && highlight.top < viewport.height;
      const next = { position: safe, hand: pointing ? handForPoint(safe, facing, pointerPlacement(highlight, viewport, null, safe).point) : undefined };
      setLayout(previous => JSON.stringify(previous) === JSON.stringify(next) ? previous : next);
    };
    const schedule = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(measure); };
    refresh.current = schedule;
    const mutation = new MutationObserver(schedule);
    mutation.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['class', 'aria-expanded', 'aria-pressed'] });
    window.addEventListener('scroll', schedule, true); window.addEventListener('resize', schedule);
    window.visualViewport?.addEventListener('resize', schedule);
    schedule();
    return () => {
      cancelAnimationFrame(frame); resize.disconnect(); mutation.disconnect(); restore();
      refresh.current = null;
      window.removeEventListener('scroll', schedule, true); window.removeEventListener('resize', schedule);
      window.visualViewport?.removeEventListener('resize', schedule);
    };
  }, [open, pathname]);
  return layout || { position, hand };
}
