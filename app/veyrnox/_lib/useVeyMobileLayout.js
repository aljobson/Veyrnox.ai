'use client';
import { useEffect, useRef, useState } from 'react';
import { clampVeyPosition, handForPoint, pointerPlacement } from '../../../lib/veyPointer';
import { dockClearance, mobileDockPosition } from '../../../lib/veyMobileLayout';

const PANEL = '[aria-label="Vey task walkthrough"], [role="dialog"][aria-labelledby="vx-helper-title"]';

export default function useVeyMobileLayout({ open, pathname, position, manualPosition, panelSide, highlight, hand, facing, pointRequest, activeTarget }) {
  const [layout, setLayout] = useState(null);
  const latest = useRef({ highlight, facing, activeTarget, manualPosition, panelSide });
  const refresh = useRef(null);
  const cue = useRef(null);
  useEffect(() => { latest.current = { highlight, facing, activeTarget, manualPosition, panelSide }; refresh.current?.(); }, [highlight, facing, activeTarget, manualPosition, panelSide]);
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
    let workspace = null;
    const restoreWorkspace = () => {
      if (!workspace) return;
      const { element, styles, overflow } = workspace;
      const scroll = element.scrollTop;
      for (const [key, value] of Object.entries(styles)) element.style[key] = value;
      root.style.overflow = overflow;
      delete root.dataset.veyMobileWorkspace;
      workspace = null;
      window.scrollTo({ top: scroll, behavior: 'instant' });
    };
    const restore = () => {
      restoreWorkspace();
      if (main && main.style.paddingBottom === applied) main.style.paddingBottom = original;
    };
    const resize = new ResizeObserver(() => schedule());
    const measure = () => {
      const { highlight, facing, activeTarget, manualPosition, panelSide } = latest.current;
      const current = document.querySelector('main');
      if (main !== current) {
        restore(); main = current; original = main?.style.paddingBottom || '';
        base = main ? parseFloat(getComputedStyle(main).paddingBottom) || 0 : 0;
      }
      const editorDock = document.querySelector('[aria-label="Mobile editor sections"]');
      const chat = document.querySelector('[role="dialog"][aria-labelledby="vx-helper-title"]');
      const guide = document.querySelector('[aria-label="Vey task walkthrough"]');
      const nextPanel = open ? (guide?.getBoundingClientRect().width > 0 ? guide : chat) : document.querySelector('[aria-label="Browser storage notice"]')
        || (editorDock?.getBoundingClientRect().height > 0 ? editorDock : null);
      if (panel !== nextPanel) { resize.disconnect(); panel = nextPanel; if (panel) resize.observe(panel); }
      const viewport = { width: innerWidth, height: innerHeight };
      const dock = panel?.getBoundingClientRect();
      const reservesSpace = open && dock && (viewport.width < 640 || !!chat);
      // Padding alone lets controls scroll underneath a fixed helper. Give the
      // mobile page its own bounded scrolling area above the complete dock.
      if (reservesSpace && viewport.width < 640 && main) {
        if (!workspace) {
          const styles = Object.fromEntries(['position', 'top', 'bottom', 'left', 'right', 'overflowY', 'overflowX', 'marginTop', 'marginBottom', 'scrollPaddingBottom'].map(key => [key, main.style[key]]));
          workspace = { element: main, styles, overflow: root.style.overflow };
          const scroll = window.scrollY;
          Object.assign(main.style, { position: 'fixed', top: '64px', left: '0px', right: '0px', overflowY: 'auto', overflowX: 'hidden', marginTop: '0px', marginBottom: '0px', scrollPaddingBottom: '16px' });
          root.style.overflow = 'hidden';
          root.dataset.veyMobileWorkspace = 'true';
          main.scrollTop = scroll;
          window.scrollTo({ top: 0, behavior: 'instant' });
        }
        main.style.bottom = `${Math.max(8, viewport.height - dock.top + 8)}px`;
      } else restoreWorkspace();
      const clearance = dockClearance(base || 0, viewport, dock);
      applied = workspace ? '24px' : reservesSpace ? `${clearance}px` : original;
      if (main && main.style.paddingBottom !== applied) main.style.paddingBottom = applied;
      appliedScrollPadding = reservesSpace ? `${clearance}px` : originalScrollPadding;
      if (root.style.scrollPaddingBottom !== appliedScrollPadding) root.style.scrollPaddingBottom = appliedScrollPadding;
      if (viewport.width >= 640 && (!chat || activeTarget)) { setLayout(null); return; }
      const pointing = open && dock && cue.current?.target === activeTarget && highlight && highlight.bottom > 72 && highlight.top < viewport.height;
      if (!pointing && cue.current?.position) cue.current = null;
      // One deliberate Show action gets one destination, not a moving search
      // for gaps. Its short pointing gesture then returns to the stable dock.
      if (pointing && !cue.current.position) cue.current.position = pointerPlacement(highlight, viewport, dock).position;
      const fixed = pointing && cue.current.position;
      const safe = fixed || (manualPosition ? clampVeyPosition(manualPosition, viewport) : mobileDockPosition(viewport, dock, open && panel?.matches(PANEL), panelSide));
      const next = { position: safe, docked: !fixed && !manualPosition, hand: fixed ? handForPoint(safe, facing, pointerPlacement(highlight, viewport, null, safe).point) : undefined };
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
