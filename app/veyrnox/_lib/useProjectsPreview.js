'use client';
import { useEffect, useState } from 'react';

// Delivery gate only; API authorization and environment flags remain authoritative.
export function useProjectsPreview() {
  const [enabled, setEnabled] = useState(false);
  useEffect(() => {
    const read = () => {
      try { setEnabled(localStorage.getItem('veyrnox_projects') === '1'); }
      catch { setEnabled(false); }
    };
    read();
    window.addEventListener('storage', read);
    return () => window.removeEventListener('storage', read);
  }, []);
  return enabled;
}
