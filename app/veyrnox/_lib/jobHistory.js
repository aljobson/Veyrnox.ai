'use client';

// Client-side ring buffer of submitted job IDs.
// The gateway has no jobs-list endpoint yet, so Library reads from here
// to know which /jobs/:id to poll. Max 50 rows, oldest evicted first.
// Scoped to the current browser only — history follows the device, not
// the account, until Phase 4 adds server-side listing.

const KEY = 'veyrnox_job_history_v1';
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
    const raw = localStorage.getItem(KEY);
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
  const list = readJobHistory().filter((r) => r.job_id !== entry.job_id);
  list.unshift({ ...entry, submitted_at: entry.submitted_at || Date.now() });
  if (list.length > MAX) list.length = MAX;
  try { localStorage.setItem(KEY, JSON.stringify(list)); } catch {}
}

/** Remove a specific job from history. */
export function removeFromJobHistory(job_id) {
  if (typeof localStorage === 'undefined') return;
  const list = readJobHistory().filter((r) => r.job_id !== job_id);
  try { localStorage.setItem(KEY, JSON.stringify(list)); } catch {}
}

/** Wipe all history — used from a settings screen if we add one. */
export function clearJobHistory() {
  if (typeof localStorage === 'undefined') return;
  try { localStorage.removeItem(KEY); } catch {}
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
  const list = readJobHistory().map((r) => (r.job_id === job_id ? { ...r, settled: state } : r));
  try { localStorage.setItem(KEY, JSON.stringify(list)); } catch {}
}
