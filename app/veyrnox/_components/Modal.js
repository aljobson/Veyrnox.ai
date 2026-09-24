'use client';
import { useEffect, useRef } from 'react';

/** Native modal supplies keyboard containment and an inert background. */
export function Modal({ children, onCancel, initialFocusRef, className = '', ...labels }) {
  const ref = useRef(null);
  useEffect(() => {
    const previous = document.activeElement;
    const dialog = ref.current;
    dialog.showModal();
    initialFocusRef?.current?.focus();
    return () => {
      dialog.close();
      if (previous?.isConnected) previous.focus();
    };
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
    className={`fixed inset-0 m-0 h-dvh w-screen max-h-none max-w-none border-0 text-vx-fg bg-black/70 backdrop:bg-transparent hidden open:flex ${className}`}
    onCancel={event => { event.preventDefault(); onCancel(); }}
    onClick={event => { if (event.target === event.currentTarget) onCancel(); }}>
    {children}
  </dialog>;
}
