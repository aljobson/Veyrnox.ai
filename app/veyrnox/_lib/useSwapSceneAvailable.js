'use client';
import { useEffect, useState } from 'react';

// Public gate for a template page: is a Swap scene published under this template id?
// Same read-only projection as Create (GET /api/catalog?swap=), no query-string dependency.
export function useSwapSceneAvailable(id) {
  const [state, setState] = useState(null);
  useEffect(() => {
    if (typeof id !== 'string' || !id) return;
    let live = true;
    fetch(`/api/catalog?swap=${encodeURIComponent(id)}`, { cache: 'no-store' })
      .then(response => response.ok ? response.json() : null)
      .then(scene => { if (live) setState({ id, ok: !!scene?.id }); }, () => { if (live) setState({ id, ok: false }); });
    return () => { live = false; };
  }, [id]);
  return state?.id === id && state.ok;
}
