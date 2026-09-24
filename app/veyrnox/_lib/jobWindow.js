// Pure window helpers for the Library grid (#perf). Job history holds up to 50
// entries and each hydration costs two authenticated gateway calls, so both the
// initial fetch and the poller are scoped to a visible window.

/** Merge by identity: the account list can differ from this browser's history. */
export function mergeHydrated(prev, results) {
  const updates = new Map(results.map((r) => [r.job_id, r]));
  const existing = new Set(prev.map((r) => r.job_id));
  return [...results.filter((r) => !existing.has(r.job_id)),
    ...prev.map((r) => updates.has(r.job_id) ? { ...r, ...updates.get(r.job_id) } : r)];
}

/**
 * True when the poller should fetch this row: inside the window and in-flight.
 * Rows past the window are optimistic placeholders that read as 'queued';
 * polling them would undo the pagination.
 * @param {object} row
 * @param {number} index
 * @param {number} visible
 */
export function shouldPoll(row, index, visible) {
  return index < visible && (row.state === 'queued' || row.state === 'running');
}
