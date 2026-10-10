'use client';
import { useEffect, useRef } from 'react';

/**
 * Native modal supplies keyboard containment and an inert background, and
 * renders in the top layer, so no ancestor can clip or re-anchor it.
 * `instant` skips the entrance, for a dialog a keystroke opens.
 */
export function Modal({ children, onCancel, initialFocusRef, instant = false, className = '', ...labels }) {
  const ref = useRef(null);
  const pressedOnScrim = useRef(false);
  // Opened once per mount. A caller that swaps its focus target (the persona
  // list and its form) used to close and reopen the dialog, which now would
  // replay the entrance; only the focus moves.
  useEffect(() => {
    const previous = document.activeElement;
    const dialog = ref.current;
    dialog.showModal();
    return () => {
      dialog.close();
      if (previous?.isConnected) previous.focus();
    };
  }, []);
  useEffect(() => {
    initialFocusRef?.current?.focus();
  }, [initialFocusRef]);
  function containTab(event) {
    if (event.key !== 'Tab') return;
    const dialog = ref.current;
    const items = [...dialog.querySelectorAll('button, input, select, textarea, a[href], [tabindex]')]
      .filter(node => !node.matches(':disabled') && node.tabIndex >= 0 && node.getClientRects().length);
    const first = items[0], last = items.at(-1);
    if (!first) { event.preventDefault(); dialog.focus(); return; }
    if (event.shiftKey && (document.activeElement === first || !dialog.contains(document.activeElement))) {
      event.preventDefault(); last.focus();
    } else if (!event.shiftKey && (document.activeElement === last || !dialog.contains(document.activeElement))) {
      event.preventDefault(); first.focus();
    }
  }
  return <dialog ref={ref} tabIndex={-1} onKeyDown={containTab} {...labels}
    className={`${instant ? '' : 'vx-overlay '}fixed inset-0 m-0 h-dvh w-screen max-h-none max-w-none border-0 text-vx-fg bg-black/70 backdrop:bg-transparent hidden open:flex ${className}`}
    onCancel={event => { event.preventDefault(); onCancel(); }}
    // The press must start on the scrim too: a text selection dragged out of
    // a field and released on the scrim is a click on the dialog.
    onMouseDown={event => { pressedOnScrim.current = event.target === event.currentTarget; }}
    onClick={event => { if (pressedOnScrim.current && event.target === event.currentTarget) onCancel(); }}>
    {children}
  </dialog>;
}
