// A real reachability check for the studio's offline notice. navigator.onLine only
// reports a network interface, so it can read false behind a VPN or after a missed
// `online` event. Any HTTP answer from our own anonymous status route, even a 5xx,
// proves the connection works; only a thrown fetch (network error or timeout) counts
// as offline.
export const PROBE_URL = '/api/status';
export const PROBE_TIMEOUT_MS = 5000;

/** @returns {Promise<boolean>} true when the server answered at all. */
export async function probeConnection(fetchImpl = fetch, timeoutMs = PROBE_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    await fetchImpl(PROBE_URL, { cache: 'no-store', credentials: 'omit', signal: controller.signal });
    return true;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}
