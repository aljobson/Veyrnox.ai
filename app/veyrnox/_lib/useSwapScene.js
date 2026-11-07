'use client';
import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';

export function useSwapScene(accountEpoch) {
  const params = useSearchParams();
  const id = params.get('swap');
  const [state, setState] = useState(null);
  useEffect(() => {
    if (id === null) return;
    let live = true;
    fetch(`/api/catalog?swap=${encodeURIComponent(id)}`, { cache: 'no-store' })
      .then(response => response.ok ? response.json() : null).then(
      scene => { if (live) setState({ id, accountEpoch, scene }); },
      () => { if (live) setState({ id, accountEpoch, scene: null }); },
    );
    return () => { live = false; };
  }, [id, accountEpoch]);
  const current = state?.id === id && state?.accountEpoch === accountEpoch;
  return { id, scene: current ? state.scene : null, loading: id !== null && !current };
}
