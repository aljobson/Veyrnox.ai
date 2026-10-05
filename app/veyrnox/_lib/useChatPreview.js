'use client';
import { useEffect, useState } from 'react';

// Delivery gate only (ADR-0067): hides the nav entry and the page until this browser opts in.
// The server flag CHAT_ENABLED and the API's own checks remain authoritative; this never grants anything.
// Returns null until the browser has been read, then true or false, so a page can wait instead of flashing the closed state.
export function useChatPreview() {
  const [enabled, setEnabled] = useState(null);
  useEffect(() => {
    const read = () => {
      try { setEnabled(localStorage.getItem('veyrnox_chat') === '1'); }
      catch { setEnabled(false); }
    };
    read();
    window.addEventListener('storage', read);
    return () => window.removeEventListener('storage', read);
  }, []);
  return enabled;
}
