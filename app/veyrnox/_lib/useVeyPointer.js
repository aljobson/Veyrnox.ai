'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { firstVisible } from '../../../lib/mascotDom';
import { HELP_TARGETS } from '../../../lib/productHelp';
import { mobileGuideScroll, pointerPlacement } from '../../../lib/veyPointer';

const LEAF = {
  'create.models': ['button[aria-pressed="true"]'],
  'create.duration': ['button[aria-pressed="true"]', 'button'],
  'create.aspect': ['button[aria-pressed="true"]', 'button'],
  'create.count': ['button[aria-pressed="true"]', 'button'],
  'create.consent': ['input[type="checkbox"]'],
  'create.upload': ['[data-assistant-control="create.upload"]', 'label:has(input[type="file"])'],
  'create.character': ['[role="switch"]', 'button[aria-pressed]', 'button'],
  'create.settings': ['button'], 'create.camera': ['button'],
  'oddlings.saved': ['button'],
};

function controlFor(id, options) {
  if (!HELP_TARGETS[id]) return null;
  const root = firstVisible(HELP_TARGETS[id].selector);
  if (!root) return null;
  const choices = id === 'create.models' && options.modelKind
    ? [`button[data-model-kind="${options.modelKind}"]${options.modelKind === 'video' ? '[data-requires-image="true"]' : ''}`, ...(LEAF[id] || [])]
    : LEAF[id] || [];
  for (const selector of choices) {
    const control = [...root.querySelectorAll(selector)].find((el) => el.getBoundingClientRect().width > 0);
    if (control) return control;
  }
  return root;
}

export default function useVeyPointer({ reduceMotion, moveMascot, setFacing, activateTarget, clearAction }) {
  const [target, setTarget] = useState(null);
  const [geometry, setGeometry] = useState(null);
  const last = useRef('');
  const clear = useCallback(() => { setTarget(null); setGeometry(null); last.current = ''; }, []);
  const locate = useCallback((id, options = {}) => {
    const element = controlFor(id, options);
    if (!element) return false;
    clearAction();
    last.current = '';
    setGeometry(null);
    setTarget({ id, options });
    element.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'center', inline: 'nearest' });
    if (options.focus && element instanceof HTMLElement) element.focus({ preventScroll: true });
    if (options.activate && HELP_TARGETS[id].canActivate) activateTarget(element, id);
    return true;
  }, [activateTarget, clearAction, reduceMotion]);

  useEffect(() => {
    if (!target) return;
    let frame;
    const main = document.querySelector('main');
    const previousPadding = main?.style.paddingBottom || '';
    const basePadding = main ? parseFloat(getComputedStyle(main).paddingBottom) || 0 : 0;
    let appliedPadding;
    const measure = () => {
      const element = controlFor(target.id, target.options);
      if (!element) { setGeometry(null); return; }
      const r = element.getBoundingClientRect();
      if (r.bottom < 72 || r.top > innerHeight || r.right < 0 || r.left > innerWidth) { setGeometry(null); return; }
      const rect = { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height };
      const obstacle = document.querySelector('[aria-label="Vey task walkthrough"]')?.getBoundingClientRect();
      if (main) {
        const padding = obstacle && innerWidth < 640 ? `${Math.max(basePadding, obstacle.height + 24)}px` : previousPadding;
        if (main.style.paddingBottom !== padding) main.style.paddingBottom = padding;
        appliedPadding = padding;
      }
      const scroll = mobileGuideScroll(rect, obstacle, { width: innerWidth });
      if (scroll > 0) window.scrollBy({ top: scroll, behavior: 'instant' });
      const next = { ...pointerPlacement(rect, { width: innerWidth, height: innerHeight }, obstacle), rect };
      const signature = JSON.stringify(next);
      if (signature === last.current) return;
      last.current = signature;
      setGeometry(next); setFacing(next.facing); moveMascot(next.position);
    };
    const schedule = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(measure); };
    const observer = new ResizeObserver(schedule);
    if (main) observer.observe(main);
    const guide = document.querySelector('[aria-label="Vey task walkthrough"]');
    if (guide) observer.observe(guide);
    const mutation = new MutationObserver(schedule);
    if (main) mutation.observe(main, { subtree: true, childList: true, attributes: true, attributeFilter: ['aria-pressed', 'aria-expanded', 'class'] });
    if (guide) mutation.observe(guide, { attributes: true, attributeFilter: ['class'] });
    window.addEventListener('scroll', schedule, true);
    window.addEventListener('resize', schedule);
    window.visualViewport?.addEventListener('resize', schedule);
    schedule();
    return () => {
      cancelAnimationFrame(frame); observer.disconnect(); mutation.disconnect();
      window.removeEventListener('scroll', schedule, true); window.removeEventListener('resize', schedule);
      window.visualViewport?.removeEventListener('resize', schedule);
      if (main && main.style.paddingBottom === appliedPadding) main.style.paddingBottom = previousPadding;
    };
  }, [target, moveMascot, setFacing]);
  return { activeTarget: target?.id, highlight: geometry?.rect, hand: geometry?.hand, point: geometry?.point, locate, clear };
}
