/**
 * Failure throttle for the shared-secret admin endpoints.
 *
 * `/api/admin/reap-assets` and `/api/admin/top-up-backfill` sit outside the
 * `/api/v1/*` middleware matcher and gate on a Worker secret only. The compare
 * is already constant time (lib/tokenMatches.js), but nothing bounded how many
 * guesses a caller could make, and a wrong guess was close to silent.
 *
 * This is deliberately a per-isolate counter, not a shared one: there is no KV
 * or Durable Object binding (wrangler.jsonc has none by design) and reaching
 * for Postgres on an unauthenticated path would let a flood of guesses spend
 * database round trips. A caller who spreads guesses across isolates gets more
 * than MAX_FAILURES, so treat this as a cost and a signal, not a hard cap —
 * the real controls stay a high-entropy secret and an edge rate-limit rule.
 *
 * The throttle is consulted only after the compare has already failed, so it
 * can never lock out the Cron Trigger or the Actions run.
 *
 * ponytail: in-isolate window. Move to a Durable Object only if the Worker logs
 * show probing that this does not blunt.
 */

const WINDOW_MS = 60 * 1000;
const MAX_FAILURES = 10;

/** bucket -> failure timestamps inside the current window. */
const failures = new Map();

function recent(bucket, now) {
    const kept = (failures.get(bucket) || []).filter((t) => now - t < WINDOW_MS);
    if (kept.length) failures.set(bucket, kept);
    else failures.delete(bucket);
    return kept;
}

/**
 * Seconds a locked-out bucket must wait, or 0 when it may try again. Call this
 * only AFTER the secret has failed to match: a caller presenting the right
 * token must never be throttled, or anyone could stall the cron by spending
 * MAX_FAILURES wrong guesses.
 *
 * @param {string} bucket  endpoint name, e.g. 'reap-assets'
 * @param {number} [now]
 * @returns {number} retry-after seconds, 0 when not throttled
 */
export function retryAfterSeconds(bucket, now = Date.now()) {
    const kept = recent(bucket, now);
    if (kept.length < MAX_FAILURES) return 0;
    return Math.max(1, Math.ceil((WINDOW_MS - (now - kept[0])) / 1000));
}

/**
 * Record one rejected attempt.
 *
 * @param {string} bucket
 * @param {number} [now]
 * @returns {number} failures now inside the window
 */
export function recordFailure(bucket, now = Date.now()) {
    const kept = recent(bucket, now);
    kept.push(now);
    failures.set(bucket, kept);
    return kept.length;
}

/** Test-only: forget every recorded failure. */
export function _reset() { failures.clear(); }
