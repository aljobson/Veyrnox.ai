'use client';

// Account-scoped display cache. Server job listings remain authoritative.
import { getSession } from '../../lib/authClient.js';

const LEGACY_KEY = 'veyrnox_job_history_v1';
const PREFIX = 'veyrnox_job_history_v2:';
function historyKey() {
  const id = getSession()?.user?.id;
  return typeof id === 'string' && id ? PREFIX + id : null;
}
const MAX = 50;

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
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

/** Push a new entry to the front. Trims to MAX. */
export function pushJobHistory(entry) {
  if (typeof localStorage === 'undefined') return;
  const key = historyKey();
  if (!key) return;
  const list = readJobHistory().filter((r) => r.job_id !== entry.job_id);
  list.unshift({ ...entry, submitted_at: entry.submitted_at || Date.now() });
  if (list.length > MAX) list.length = MAX;
  try { localStorage.setItem(key, JSON.stringify(list)); } catch {}
}

/** Remove a specific job from history. */
export function removeFromJobHistory(job_id) {
  if (typeof localStorage === 'undefined') return;
  const key = historyKey();
  if (!key) return;
  const list = readJobHistory().filter((r) => r.job_id !== job_id);
  try { localStorage.setItem(key, JSON.stringify(list)); } catch {}
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
}

// A job older than this with no recorded outcome is left alone rather than
// announced: entries from before background notices existed, or a job the
// sweep already settled while this browser was away.
export const WATCH_MAX_AGE_MS = 60 * 60 * 1000;

/** Entries still worth polling: no outcome recorded yet, and recent. */
export function jobsToWatch(history, now = Date.now()) {
  return (history || []).filter((r) => r && r.job_id && !r.settled && now - (r.submitted_at || 0) < WATCH_MAX_AGE_MS);
}

/** Record a job's outcome so no page announces it twice. */
export function markJobSettled(job_id, state) {
  if (typeof localStorage === 'undefined') return;
  const key = historyKey();
  if (!key) return;
  const list = readJobHistory().map((r) => (r.job_id === job_id ? { ...r, settled: state } : r));
  try { localStorage.setItem(key, JSON.stringify(list)); } catch {}
}
