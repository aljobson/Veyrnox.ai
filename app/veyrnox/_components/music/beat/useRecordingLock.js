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
    const attributes = { disabled: '', title: RECORDING_LOCK_REASON, 'aria-disabled': 'true' };
    function rememberUpdates(records) {
      for (const { target, attributeName, type } of records) {
        if (type === 'attributes' && changed.has(target)) changed.get(target)[attributeName] = target.getAttribute(attributeName);
      }
    }
    function lock(records = []) {
      rememberUpdates(records);
      observer.disconnect();
      for (const control of element.querySelectorAll('button, input, select, textarea, a, [tabindex], summary')) {
        if (control.closest('[data-beat-live]')) continue;
        if (!changed.has(control)) changed.set(control, Object.fromEntries(Object.keys(attributes).map((name) => [name, control.getAttribute(name)])));
        if ('disabled' in control && !control.disabled) control.disabled = true;
        if (control.getAttribute('title') !== RECORDING_LOCK_REASON) control.setAttribute('title', RECORDING_LOCK_REASON);
        if (control.getAttribute('aria-disabled') !== 'true') control.setAttribute('aria-disabled', 'true');
      }
      observer.observe(element, { childList: true, subtree: true, attributes: true, attributeFilter: Object.keys(attributes) });
    }
    function block(e) {
      if (e.type === 'keydown' && !['Enter', ' ', 'Delete', 'Backspace', '+', '-', '=', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) return;
      if (!e.target.closest('[data-beat-live]')) { e.preventDefault(); e.stopPropagation(); } }
    const observer = new MutationObserver(lock);
    lock();
    for (const type of ['click', 'keydown', 'pointerdown', 'dblclick', 'drop']) element.addEventListener(type, block, true);
    return () => {
      rememberUpdates(observer.takeRecords());
      observer.disconnect();
      for (const type of ['click', 'keydown', 'pointerdown', 'dblclick', 'drop']) element.removeEventListener(type, block, true);
      for (const [control, old] of changed) {
        for (const [key, value] of Object.entries(old)) {
          // Only undo our own value; retain the latest React-owned state.
          if (control.getAttribute(key) !== attributes[key]) continue;
          if (value === null) control.removeAttribute(key); else control.setAttribute(key, value);
        }
      }
    };
  }, [root, locked]);
}
