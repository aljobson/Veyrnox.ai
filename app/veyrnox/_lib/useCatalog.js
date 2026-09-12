'use client';
import { useEffect, useState } from 'react';
import { MODELS, kindOf } from './tokens';

// Normalised shape shared by every consumer:
// { id, name, kind ('video'|'image'|'audio'), credits, gated }
function fromFallback() {
  return MODELS.map((m) => ({
    id: m.id, name: m.name, kind: m.kind, credits: m.credits, gated: !!m.gated || !!m.premium,
  }));
}

function fromApi(models) {
  return models.map((m) => ({
    id: m.id, name: m.name, kind: kindOf(m.modality), credits: m.credits, gated: !!m.gated,
  }));
}

// Public, unauthenticated GET /api/catalog. Falls back to tokens.js MODELS so
// the UI never renders an empty picker. `live` tells callers which path won.
export function useCatalog() {
  const [state, setState] = useState({ models: fromFallback(), live: false, loading: true });
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/catalog', { cache: 'no-store' });
        if (!res.ok) throw new Error(String(res.status));
        const data = await res.json();
        if (!Array.isArray(data?.models) || !data.models.length) throw new Error('empty');
        if (!cancelled) setState({ models: fromApi(data.models), live: true, loading: false });
      } catch {
        if (!cancelled) setState((s) => ({ ...s, loading: false }));
      }
    })();
    return () => { cancelled = true; };
  }, []);
  return state;
}
