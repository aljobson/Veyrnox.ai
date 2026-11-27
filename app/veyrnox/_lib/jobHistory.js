'use client';

// Account-scoped display cache. Server job listings remain authoritative.
import { getSession } from '../../lib/authClient.js';
import { createGenerationClaimer, WATCH_MAX_AGE_MS } from './generationClaim.mjs';
export { WATCH_MAX_AGE_MS };
const claim = createGenerationClaimer();
import { signalVeyMood, veyErrorSituation } from '../../../lib/veyMood.js';

const LEGACY_KEY = 'veyrnox_job_history_v1';
const PREFIX = 'veyrnox_job_history_v2:';
function historyKey() {
  const id = getSession()?.user?.id;
  return typeof id === 'string' && id ? PREFIX + id : null;
}
const MAX = 50;
// Compatibility with draft caches and swap's UI states; history keeps raw job states.
const historyState = state => state === 'refunded' || state === 'cancelled' ? 'failed' : state;

/** Fired on this tab whenever the history changes (other tabs fire `storage`). */
export const JOBS_CHANGED_EVENT = 'veyrnox:jobs-changed';
export const GENERATION_SUCCEEDED_EVENT = 'veyrnox:generation-succeeded';
function announceChange() {
  try { if (typeof window !== 'undefined') window.dispatchEvent(new Event(JOBS_CHANGED_EVENT)); } catch { /* no window */ }
}

/** @typedef {object} JobHistoryEntry
 *  @property {string} job_id
 *  @property {string} model_id
 *  @property {number} credits
 *  @property {number} submitted_at   Date.now()
 *  @property {string} [name]         human-writable label
 *  @property {string} [prompt]       first 60 chars for display
 */

/** @returns {JobHistoryEntry[]} newest first */
export function readJobHistory() {
  if (typeof localStorage === 'undefined') return [];
  try {
    localStorage.removeItem(LEGACY_KEY);
    const key = historyKey();
    if (!key) return [];
    const raw = localStorage.getItem(key);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr.filter(r => r && typeof r.job_id === 'string').map(r => {
      const { job_id, model_id, credits, name, prompt, submitted_at, settled, replay_check } = r;
      return { job_id, model_id, credits, name, prompt, submitted_at, settled: historyState(settled), replay_check };
    }) : [];
  } catch {
    return [];
  }
}

/** Push a new entry to the front. Trims to MAX. */
export function pushJobHistory(entry) {
  if (typeof localStorage === 'undefined') return;
  const key = historyKey();
  if (!key) return;
  const history = readJobHistory();
  const existing = history.find(r => r.job_id === entry.job_id);
  const list = history.filter(r => r.job_id !== entry.job_id);
  // An allowlist keeps signed URLs and arbitrary response fields out of storage.
  const { job_id, model_id, credits, name, prompt } = entry;
  list.unshift({ job_id, model_id, credits, name, prompt,
    submitted_at: [existing?.submitted_at, entry.submitted_at].find(value => Number.isFinite(value) && value > 0) ?? Date.now(),
    settled: existing?.settled || historyState(entry.settled),
    // Without local retry evidence or server timestamps, a first terminal read is suppressed; a fast lost-response completion can therefore be missed.
    replay_check: Number.isFinite(existing?.submitted_at) && existing.submitted_at > 0 ? existing.replay_check : !!(entry.idempotent && !entry.recovering),
  });
  if (list.length > MAX) list.length = MAX;
  try { localStorage.setItem(key, JSON.stringify(list)); } catch {}
  announceChange();
}

/** Remove a specific job from history. */
export function removeFromJobHistory(job_id) {
  if (typeof localStorage === 'undefined') return;
  const key = historyKey();
  if (!key) return;
  const list = readJobHistory().filter((r) => r.job_id !== job_id);
  try { localStorage.setItem(key, JSON.stringify(list)); } catch {}
  announceChange();
}

/** Remove every account cache and the retired unscoped cache on identity changes. */
export function clearJobHistory() {
  if (typeof localStorage === 'undefined') return;
  try {
    const current = historyKey();
    if (current) localStorage.removeItem(current);
    localStorage.removeItem(LEGACY_KEY);
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const key = localStorage.key(i);
      if (key?.startsWith(PREFIX)) localStorage.removeItem(key);
    }
  } catch { /* storage may be unavailable */ }
  announceChange();
}

// A job older than this with no recorded outcome is left alone rather than
// announced: entries from before background notices existed, or a job the
// sweep already settled while this browser was away.


/** Entries still worth polling: no outcome recorded yet, and recent. */
export function jobsToWatch(history, now = Date.now()) {
  return (history || []).filter((r) => r && r.job_id && !r.settled && now - (r.submitted_at || 0) < WATCH_MAX_AGE_MS);
}

// Every completion path uses the same claim; settlement itself never changes money.
function signalSettled(entry, state, errorCode, credits, refunded = false) {
  if (state === 'succeeded') {
    signalVeyMood('generation-succeeded');
    if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(GENERATION_SUCCEEDED_EVENT, {
      detail: { job_id: entry.job_id, label: entry.name || entry.prompt || '', credits: credits ?? entry.credits },
    }));
  } else if (state === 'failed') signalVeyMood(veyErrorSituation(errorCode, { refunded }) || 'generation-failed');
}

export async function markJobSettled(job_id, state, errorCode, credits, refunded = false) {
  const owner = getSession()?.user?.id;
  const key = historyKey();
  if (!key) return false;
  if (!['queued', 'running', 'succeeded', 'failed', 'refunded', 'cancelled'].includes(state)) return false;
  const isRefunded = refunded === true || state === 'refunded';
  const settledState = isRefunded ? 'failed' : historyState(state);
  let historyChanged = false;
  let storage;
  try { storage = localStorage; } catch { /* memory-only claim */ }
  const entry = readJobHistory().find(r => r.job_id === job_id);
  const won = await claim({ owner, id: job_id, submittedAt: entry?.submitted_at,
    currentOwner: () => getSession()?.user?.id, storage,
    locks: typeof navigator === 'undefined' ? null : navigator.locks,
    settle: () => {
      const list = readJobHistory();
      const current = list.find(r => r.job_id === job_id);
      if (!current || current.settled) return false;
      if (settledState === 'queued' || settledState === 'running') {
        if (current.replay_check) {
          try {
            storage?.setItem(key, JSON.stringify(list.map(r => r.job_id === job_id ? { ...r, replay_check: false } : r)));
            historyChanged = true;
          } catch { /* Keep watching. */ }
        }
        return false;
      }
      try {
        storage?.setItem(key, JSON.stringify(list.map(r => r.job_id === job_id ? { ...r, settled: settledState } : r)));
        historyChanged = true;
      } catch { /* unavailable */ }
      return !current.replay_check;
    },
  });
  if (won && getSession()?.user?.id === owner) signalSettled(entry, settledState, errorCode, credits, isRefunded);
  // A running watcher reads the same state every five seconds. Broadcasting
  // those no-op reads wakes the swap poll immediately and can exhaust its
  // long-running window in seconds. Notify only when the history changed.
  if (historyChanged) announceChange();
  return won;
}

// Music candidates need no /jobs watcher, but share the same account/job claim.
export async function settleGenerationResult(entry, owner) {
  let storage;
  try { storage = localStorage; } catch { /* same-tab fallback */ }
  const won = await claim({ owner, id: entry.job_id, submittedAt: entry.submitted_at,
    currentOwner: () => getSession()?.user?.id, storage,
    locks: typeof navigator === 'undefined' ? null : navigator.locks, settle: () => !entry.idempotent && !entry.refunded,
  });
  if (won && getSession()?.user?.id === owner) signalSettled(entry, 'succeeded');
}
