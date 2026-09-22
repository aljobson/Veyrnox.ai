'use client';
import { useEffect, useState } from 'react';
import { MODELS, kindOf } from './tokens';

// Normalised shape shared by every consumer:
// { id, name, kind ('video'|'image'|'audio'), credits, gated, durations, media? }
const FALLBACK_DURATIONS = [5];

function fromFallback() {
  return MODELS.map((m) => ({
    id: m.id, name: m.name, kind: m.kind, credits: m.credits, gated: !!m.gated || !!m.premium,
    durations: m.durations || FALLBACK_DURATIONS,
  }));
}

function fromApi(models) {
  return models.map((m) => ({
    id: m.id, name: m.name, kind: kindOf(m.modality), credits: m.credits, gated: !!m.gated,
    // An older Worker that predates `durations` omits it; 5s only is the
    // safe read, and it is what the gateway accepts everywhere.
    durations: Array.isArray(m.durations) && m.durations.length ? m.durations : FALLBACK_DURATIONS,
    // Reference slots from the capability registry, e.g. { image: { required } }.
    media: (m.capabilities && m.capabilities.media) || {},
    // Aspect ratios this model accepts, or null when it takes none.
    aspects: m.capabilities?.inputs?.aspect_ratio?.values || null,
    // Auto Short (ADR-0029): takes a topic instead of a prompt.
    takesTopic: !!m.capabilities?.inputs?.topic,
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
        // Default caching on purpose: /api/catalog serves
        // `public, max-age=60, s-maxage=300`. `no-store` threw that away and
        // made every page mount a fresh Worker round trip.
        const res = await fetch('/api/catalog');
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
