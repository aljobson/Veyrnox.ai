'use client';
import { useEffect, useState } from 'react';

/** The full-screen editor reserves physical space for its ordinary helper toggle. */
export default function useEditorHelperHost(pathname) {
  const [host, setHost] = useState(null);
  useEffect(() => {
    let frame;
    const update = () => {
      const next = pathname === '/app/editor' ? document.querySelector('[data-vey-editor-helper]') : null;
      setHost(previous => previous === next ? previous : next);
    };
    const schedule = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(update); };
    const observer = new MutationObserver(schedule);
    observer.observe(document.body, { childList: true, subtree: true });
    schedule();
    return () => { cancelAnimationFrame(frame); observer.disconnect(); };
  }, [pathname]);
  return host;
}
