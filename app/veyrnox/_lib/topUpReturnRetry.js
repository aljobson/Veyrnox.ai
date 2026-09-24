// Keep the captured session in memory while retrying temporary quota outages.
// Three total attempts; each callback reuses the same Top-up/session pair.
export async function retryTopUpReturn(send, {
  signal,
  wait = (ms) => new Promise((resolve) => {
    const done = () => { clearTimeout(timer); signal?.removeEventListener('abort', done); resolve(); };
    const timer = setTimeout(done, ms);
    signal?.addEventListener('abort', done, { once: true });
    if (signal?.aborted) done();
  }),
} = {}) {
  for (let attempt = 0; attempt < 3 && !signal?.aborted; attempt++) {
    try { return await send(); } catch (error) {
      if (signal?.aborted || attempt === 2 || ![429, 503].includes(error?.status)) return;
      const fallback = error.status === 429 ? 60 : 30;
      const seconds = Number.isFinite(error.retryAfter) ? Math.max(1, Math.min(60, error.retryAfter)) : fallback;
      await wait(seconds * 1000);
    }
  }
}
