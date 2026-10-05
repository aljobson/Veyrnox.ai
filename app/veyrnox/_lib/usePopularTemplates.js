'use client';
import { useEffect, useState } from 'react';

// The ranked template ids from /api/popular-templates. Empty while loading, when nothing has enough use yet, or when the read fails:
// no Popular filter is the safe answer, because the gallery is complete without it.
export function usePopularTemplates() {
  const [ids, setIds] = useState([]);
  useEffect(() => {
    let live = true;
    fetch('/api/popular-templates')
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => { if (live && j && Array.isArray(j.templates)) setIds(j.templates.filter((id) => typeof id === 'string')); })
      .catch(() => {});
    return () => { live = false; };
  }, []);
  return ids;
}
