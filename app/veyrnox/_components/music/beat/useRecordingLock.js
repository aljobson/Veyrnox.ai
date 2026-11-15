'use client';
import { useEffect } from 'react';
import { RECORDING_LOCK_REASON } from '../../../_lib/music/beat/beatRecordingPolicy.mjs';
export { RECORDING_LOCK_REASON } from '../../../_lib/music/beat/beatRecordingPolicy.mjs';
// Keep native disabled semantics even for controls inside library dialogs. Live
// channel controls and keys explicitly opt in; no editing event escapes the lock.
export function useRecordingLock(root, locked) {
  useEffect(() => {
    if (!locked || !root.current) return;
    const element = root.current, changed = new Map();
    function lock() {
      for (const control of element.querySelectorAll('button, input, select, textarea, a, [tabindex], summary')) {
        if (control.closest('[data-beat-live]')) continue;
        if (!changed.has(control)) changed.set(control, { disabled: control.disabled, title: control.getAttribute('title'), aria: control.getAttribute('aria-disabled') });
        if ('disabled' in control && !control.disabled) control.disabled = true;
        if (control.getAttribute('title') !== RECORDING_LOCK_REASON) control.setAttribute('title', RECORDING_LOCK_REASON);
        if (control.getAttribute('aria-disabled') !== 'true') control.setAttribute('aria-disabled', 'true');
      }
    }
    function block(e) {
      if (e.type === 'keydown' && !e.ctrlKey && !e.metaKey && !e.altKey && /^[aw sedftgyhujkolp;zxcv]$/i.test(e.key) && !e.target.closest('input, select, textarea, [contenteditable=true]')) return;
      if (!e.target.closest('[data-beat-live]')) { e.preventDefault(); e.stopPropagation(); } }
    lock();
    const observer = new MutationObserver(lock); observer.observe(element, { childList: true, subtree: true, attributes: true, attributeFilter: ['disabled', 'aria-disabled'] });
    for (const type of ['click', 'keydown', 'pointerdown', 'dblclick', 'drop']) element.addEventListener(type, block, true);
    return () => {
      observer.disconnect();
      for (const type of ['click', 'keydown', 'pointerdown', 'dblclick', 'drop']) element.removeEventListener(type, block, true);
      for (const [control, old] of changed) {
        if ('disabled' in control) control.disabled = old.disabled;
        for (const [key, value] of [['title', old.title], ['aria-disabled', old.aria]]) if (value === null) control.removeAttribute(key); else control.setAttribute(key, value);
      }
    };
  }, [root, locked]);
}
