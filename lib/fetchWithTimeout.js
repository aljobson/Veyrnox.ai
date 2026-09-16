/**
 * fetch with a deadline.
 *
 * Every outbound call from the Worker needs one: workerd will happily keep a
 * request open until the invocation is killed, and a provider or PostgREST
 * that accepts a connection and then stalls turns one slow dependency into a
 * stuck webhook delivery (which the provider then retries) or, on the auth
 * path, a stalled request for every signed-in user.
 *
 * `AbortController` + `setTimeout` rather than `AbortSignal.timeout()`: the
 * former is what the rest of this repo already proves out on workerd
 * (fal.js, kie.js, lemonsqueezy.js, r2.js, supabase-client.js).
 *
 * @param {string|URL|Request} input
 * @param {RequestInit} [init]
 * @param {number} [timeoutMs=8000]
 * @returns {Promise<Response>}  rejects with an AbortError past the deadline
 */
export function fetchWithTimeout(input, init = {}, timeoutMs = 8000) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    return fetch(input, { ...init, signal: controller.signal }).finally(() => clearTimeout(timer));
}
