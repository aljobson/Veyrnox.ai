// The gate that runs inside the FilmCraft document before the wasm is imported or anything is
// written to storage (plan rev 7). It only lets the editor start when this document is framed by
// our own host page, proven by a same-origin parent that hands out a single-use nonce.

const NONCE_RE = /^[0-9a-f]{32}$/;

/**
 * @param {{win: Window}} deps  a window-like object (tests pass a fake)
 * @returns {{ok: true, requestRestart: Function} | {ok: false, reason: string}}
 */
export function evaluateGate({ win }) {
  let parent;
  try {
    parent = win.parent;
    if (!parent || parent === win) return { ok: false, reason: 'not-framed' };
    // A cross-origin parent throws on location access.
    if (parent.location.origin !== win.location.origin) return { ok: false, reason: 'parent-origin-mismatch' };
  } catch {
    return { ok: false, reason: 'parent-cross-origin' };
  }

  const params = new URLSearchParams(win.location.search);
  const nonce = params.get('hn');
  if (typeof nonce !== 'string' || !NONCE_RE.test(nonce)) return { ok: false, reason: 'no-nonce' };

  let host;
  try {
    host = parent.__proHost;
  } catch {
    return { ok: false, reason: 'no-host' };
  }
  if (!host || typeof host.consume !== 'function') return { ok: false, reason: 'no-host' };

  const requestRestart = host.consume(nonce);
  if (typeof requestRestart !== 'function') return { ok: false, reason: 'bad-nonce' };

  // The nonce is spent: remove it from the visible URL.
  try {
    params.delete('hn');
    const query = params.toString().replace(/=(&|$)/g, '$1');
    win.history.replaceState(null, '', win.location.pathname + (query ? '?' + query : '') + win.location.hash);
  } catch { /* the URL is cosmetic once the nonce is consumed */ }

  return { ok: true, requestRestart };
}
