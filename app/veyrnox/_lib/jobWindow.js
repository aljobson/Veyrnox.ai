// Pure window helpers for the Library grid (#perf). Job history holds up to 50
// entries and each hydration costs two authenticated gateway calls, so both the
// initial fetch and the poller are scoped to a visible window.

/**
 * Splice freshly hydrated rows over the head of the existing list, keeping the
 * un-hydrated tail (which still renders from localStorage) untouched.
 * @param {object[]} prev
 * @param {object[]} results  hydrated rows, newest first, aligned with prev[0..]
 * @returns {object[]}
 */
export function mergeHydrated(prev, results) {
  return [...results, ...prev.slice(results.length)];
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
