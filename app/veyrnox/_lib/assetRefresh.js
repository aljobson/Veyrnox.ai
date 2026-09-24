// One automatic retry per signed URL lifetime. A broken/deleted file must
// not turn media error events into an endless stream of signing requests.
export function createAssetRefresher({ jobId, fetchAsset, onChange, now = Date.now }) {
  let disposed = false;
  let pending = null;
  let retryAt = 0;
  let lastError = null;

  function refresh(manual = false) {
    if (disposed || !jobId) return Promise.resolve();
    if (pending) return pending;
    if (!manual && now() < retryAt) {
      lastError ||= 'Could not load this file. Try again.';
      onChange({ loading: false, error: lastError });
      return Promise.resolve();
    }
    retryAt = Infinity;
    lastError = null;
    onChange({ loading: true, error: null });
    pending = Promise.resolve().then(() => disposed ? null : fetchAsset(jobId)).then((asset) => {
      if (disposed) return;
      if (!asset || typeof asset.url !== 'string' || !asset.url.startsWith('https://')) throw new Error('invalid asset response');
      const ttl = Number.isFinite(asset.expires_in) && asset.expires_in > 0 ? asset.expires_in : 900;
      retryAt = now() + Math.min(ttl, 900) * 1000;
      onChange({ url: asset.url, loading: false, error: null });
    }).catch((error) => {
      if (disposed) return;
      const message = error?.status === 404 ? 'This file is no longer available.'
        : error?.status === 401 ? 'Sign in again to load this file.'
          : 'Could not load this file. Try again.';
      lastError = message;
      onChange({ loading: false, error: message });
    }).finally(() => { pending = null; });
    return pending;
  }

  return {
    refresh,
    loaded: () => {
      if (!disposed && !pending) { lastError = null; onChange({ loading: false, error: null }); }
    },
    dispose: () => { disposed = true; },
  };
}
