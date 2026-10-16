'use client';

import { useEffect, useRef, useState } from 'react';

const RESET_AFTER_MS = 2500;

// Share or copy the link to a gallery page. The address is built in the browser
// from the origin it is open on, so staging shares staging links, and from a
// path the server chose, never from anything the visitor typed. Every browser
// API is optional: where sharing and the clipboard are both missing, the
// message says to copy the address bar.
export function ShareLinkButton({ path, title, label = 'Copy link', className = '' }) {
  const [message, setMessage] = useState('');
  const timer = useRef(null);

  useEffect(() => () => clearTimeout(timer.current), []);

  const say = (text) => {
    setMessage(text);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setMessage(''), RESET_AFTER_MS);
  };

  async function share() {
    const url = `${window.location.origin}${path}`;
    try {
      if (typeof navigator.share === 'function') {
        await navigator.share({ title, url });
        return;
      }
    } catch (error) {
      // Closing the share sheet is a choice, not a failure.
      if (error && error.name === 'AbortError') return;
    }
    try {
      await navigator.clipboard.writeText(url);
      say('Link copied');
    } catch {
      say('Copy the address from your browser bar');
    }
  }

  return (
    <span className="inline-flex items-center gap-3">
      <button type="button" onClick={share} className={className}>{label}</button>
      <span role="status" aria-live="polite" className="text-[13px] text-vx-fg-muted">{message}</span>
    </span>
  );
}
