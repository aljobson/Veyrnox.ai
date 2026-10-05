/**
 * Jev (TypeSafe System One): typed decisions over a text state (ADR-0066).
 *
 * One POST per call, plain fetch, no SDK: the SDK's 2 retries on a 10 s
 * timeout are too slow for a request path. Every failure (no key, timeout,
 * non-2xx, malformed answer) returns null, and every caller treats null as
 * "decide the way we did before Jev". Nothing here may gate money.
 *
 * The state is never logged: it can hold vendor text that echoes a prompt.
 */

// Outbound host is a constant (CLAUDE.md, SSRF rule).
export const JEV_API_BASE = 'https://api.typesafe.ai';
// Pinned, not jev-latest: thresholds are tuned against this checkpoint.
export const JEV_MODEL = 'jev-1.13.0';
export const JEV_MODES = ['off', 'shadow', 'enforce'];

const DEFAULT_TIMEOUT_MS = 1500;
const MAX_STATE_CHARS = 4000;

/**
 * The rollout mode for one Jev use, from a wrangler var such as
 * JEV_SUBMIT_ERRORS_MODE. Anything unrecognised is 'off'.
 * @param {string|undefined} value
 * @returns {'off'|'shadow'|'enforce'}
 */
export function jevMode(value) {
    return JEV_MODES.includes(value) ? value : 'off';
}

/**
 * @param {{apiKey?: string, state: string|object, questions: object, timeoutMs?: number}} req
 * @returns {Promise<object|null>} the `answers` map, or null on any failure
 */
export async function decide({ apiKey, state, questions, timeoutMs = DEFAULT_TIMEOUT_MS }) {
    if (!apiKey) return null;
    const boundedState = typeof state === 'string' ? state.slice(0, MAX_STATE_CHARS) : state;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const res = await fetch(`${JEV_API_BASE}/v1/systemone`, {
            method: 'POST',
            signal: controller.signal,
            headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ model: JEV_MODEL, state: boundedState, questions }),
        });
        if (!res.ok) {
            console.error('[jev] request failed:', res.status);
            return null;
        }
        const data = await res.json().catch(() => null);
        const answers = data && data.answers;
        if (!answers || typeof answers !== 'object') {
            console.error('[jev] response had no answers');
            return null;
        }
        return answers;
    } catch (err) {
        console.error('[jev] request error:', err && err.name);
        return null;
    } finally {
        clearTimeout(timer);
    }
}

/**
 * The chosen option of a choice answer, if it is one of `options` and its
 * probability reaches `minProbability`; otherwise null.
 * @param {any} answer
 * @param {string[]} options
 * @param {number} minProbability
 * @returns {{choice: string, probability: number}|null}
 */
export function confidentChoice(answer, options, minProbability) {
    if (!answer || answer.type !== 'choice' || !options.includes(answer.choice)) return null;
    const p = Number(answer.probabilities && answer.probabilities[answer.choice]);
    if (!Number.isFinite(p) || p < minProbability) return null;
    return { choice: answer.choice, probability: p };
}
