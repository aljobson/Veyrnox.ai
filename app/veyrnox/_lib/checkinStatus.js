// One status read per viewer/UTC day. Only transport/server failures retry,
// after 1, 2 and 4 minutes; focus, remounts and manual opens share this budget.
export function createCheckinStatusReader(fetchStatus, now = Date.now) {
  let state;
  function current() {
    const day = new Date(now()).toISOString().slice(0, 10);
    if (state?.day !== day) state = { day, value: null, complete: false, failures: 0, next: 0, pending: null };
    return state;
  }
  const due = () => { const s = current(); return !s.complete && !s.pending && now() >= s.next; };
  function update(value) {
    state = { ...current(), value, complete: true, pending: null };
  }
  async function read() {
    const s = current();
    if (s.pending) return s.pending;
    if (!due()) return s.value;
    s.pending = (async () => {
      try { s.value = await Promise.resolve().then(fetchStatus); s.complete = true; }
      catch (error) {
        s.value = null;
        const retryable = error?.status >= 500 || error?.code === 'network_error' || error?.code === 'network' || error instanceof TypeError;
        if (retryable && s.failures < 3) s.next = now() + 60_000 * 2 ** s.failures++;
        else s.complete = true; // 403/404 and all other client refusals stop for today.
      } finally { s.pending = null; }
      return current() === s ? s.value : current().value;
    })();
    return s.pending;
  }
  return { due, read, peek: () => current().value, update, stop: () => update(null) };
}

const readers = new Map();
export function checkinStatusReader(user, fetchStatus) {
  if (!readers.has(user)) readers.set(user, createCheckinStatusReader(fetchStatus));
  return readers.get(user);
}
