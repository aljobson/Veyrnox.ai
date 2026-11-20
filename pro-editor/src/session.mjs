// Session primitives for the Pro editor host page: the single-instance lock, the storage purge,
// the single-use nonce and the restart limiter (plan rev 5, 7 and 8). Every dependency is passed
// in, so tests use fakes and the browser entry passes the real objects.

export const LOCK_NAME = 'veyrnox-pro-editor';
export const CLEANUP_KEY = 'veyrnox-pro-cleanup-pending';
export const MAX_RESTARTS = 3;

/**
 * Takes the lock with ifAvailable and holds it until release() is called (or the document dies).
 * Never queues and never steals: a second instance gets { ok: false, reason: 'owned-elsewhere' }.
 */
export function acquireSessionLock(locks, name = LOCK_NAME) {
  if (!locks || typeof locks.request !== 'function') {
    return Promise.resolve({ ok: false, reason: 'locks-unavailable' });
  }
  return new Promise((resolve) => {
    let release;
    const held = new Promise((r) => { release = r; });
    let settled = false;
    const done = (value) => { if (!settled) { settled = true; resolve(value); } };
    Promise.resolve(locks.request(name, { ifAvailable: true }, (lock) => {
      if (!lock) { done({ ok: false, reason: 'owned-elsewhere' }); return undefined; }
      done({ ok: true, release: () => release() });
      return held;
    })).catch(() => done({ ok: false, reason: 'locks-unavailable' }));
  });
}

/**
 * Wipes everything the upstream editor may have written on this origin: the whole OPFS root and
 * localStorage (apart from the cleanup marker). The marker is set before the wipe and cleared
 * only after it succeeded, so a crash mid-wipe leaves it set and the next start repeats the wipe.
 */
export async function purgeStorage({ getRoot, storage, clearLocalStorage = true, key = CLEANUP_KEY }) {
  try {
    storage.setItem(key, '1');
  } catch (error) {
    return { ok: false, reason: 'purge-failed', detail: 'marker: ' + String(error) };
  }
  try {
    const root = await getRoot();
    const names = [];
    for await (const entry of root.entries()) names.push(entry[0]);
    for (const name of names) await root.removeEntry(name, { recursive: true });
    if (clearLocalStorage) {
      const keys = [];
      for (let i = 0; i < storage.length; i += 1) keys.push(storage.key(i));
      for (const k of keys) if (k !== key) storage.removeItem(k);
    }
    storage.removeItem(key);
    return { ok: true, removed: names.length };
  } catch (error) {
    return { ok: false, reason: 'purge-failed', detail: String(error && error.message || error) };
  }
}

/** 128-bit random hex string; `crypto` must offer getRandomValues. */
export function randomHex(crypto, bytes = 16) {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  let out = '';
  for (const b of buf) out += b.toString(16).padStart(2, '0');
  return out;
}

/** Counts restarts for one session; refuses past `max`. */
export function createRestartLimiter(max = MAX_RESTARTS) {
  let count = 0;
  return {
    take() {
      if (count >= max) return false;
      count += 1;
      return true;
    },
    get count() { return count; },
  };
}
