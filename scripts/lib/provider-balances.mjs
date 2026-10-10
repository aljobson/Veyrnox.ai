/**
 * Prepaid provider balances, read with the provider's own read-only endpoint.
 *
 * fal.ai, kie.ai and OpenRouter are paid from balances the owner tops up by
 * hand. Nothing in the app reads them: when one reaches zero the provider
 * refuses the submit, the customer is refunded, and every model on that
 * provider is down until someone notices. These readers exist so
 * .github/workflows/provider-balances.yml can notice first.
 *
 * Each reader takes a `fetch` so tests can stub the network, hits one fixed
 * URL, and answers a typed result:
 *   { ok: true,  balance, unit }
 *   { ok: false, error }     error is one of ERRORS, never the vendor's text
 * A failure is never a pass: the caller reports "could not read", not "fine".
 * The key appears in the Authorization header only; it is never returned,
 * logged or interpolated into an error.
 *
 * Sources (read 2026-10-10):
 *   fal        fal.ai/docs/platform-apis/v1/account/billing — GET /v1/account/billing?expand=credits,
 *              permission billing:usage:read (presets BILLING, READONLY, FULL; not API).
 *              { username, credits: { current_balance, currency } }
 *   kie        docs.kie.ai/common-api/get-account-credits — GET /api/v1/chat/credit,
 *              { code, msg, data } with data = remaining credits; HTTP 200 even on failure.
 *   openrouter openrouter.ai/docs/api/api-reference/credits/get-credits — GET /api/v1/credits,
 *              Management key only; { data: { total_credits, total_usage } } in USD.
 *   grsai      no balance endpoint is documented (grsai.com/dashboard/documents), so no reader.
 */

export const FAL_BILLING_URL = 'https://api.fal.ai/v1/account/billing?expand=credits';
export const KIE_CREDIT_URL = 'https://api.kie.ai/api/v1/chat/credit';
export const OPENROUTER_CREDITS_URL = 'https://openrouter.ai/api/v1/credits';

export const TIMEOUT_MS = 15000;
const MAX_BODY_BYTES = 64 * 1024;

export const ERRORS = Object.freeze({
    not_configured: 'no key in the environment',
    auth_failed: 'the provider refused the key (401)',
    forbidden: 'the key lacks the permission this endpoint needs (403)',
    rate_limited: 'the provider rate limited the read (429)',
    unavailable: 'the provider answered 5xx',
    timeout: `no answer within ${TIMEOUT_MS / 1000}s`,
    unreachable: 'the request did not complete',
    bad_response: 'the answer did not have the documented shape',
});

/**
 * The balance a reading leaves after the floor: `low` when it is at or under
 * the floor, `ok` above it, `unreadable` when the read failed. A floor that is
 * not a finite non-negative number is a configuration error, so the reading is
 * unreadable too: a bad threshold must not read as a pass.
 */
export function assess(reading, floor) {
    if (!reading || reading.ok !== true) return 'unreadable';
    if (typeof floor !== 'number' || !Number.isFinite(floor) || floor < 0) return 'unreadable';
    return reading.balance <= floor ? 'low' : 'ok';
}

function statusError(status) {
    if (status === 401) return 'auth_failed';
    if (status === 403) return 'forbidden';
    if (status === 429) return 'rate_limited';
    if (status >= 500) return 'unavailable';
    return 'bad_response';
}

/** One GET to a fixed URL; JSON body under the cap or a typed failure. */
async function readJson(fetcher, url, headers) {
    let res;
    try {
        res = await fetcher(url, { method: 'GET', headers: { Accept: 'application/json', ...headers }, redirect: 'manual', signal: AbortSignal.timeout(TIMEOUT_MS) });
    } catch (err) {
        return { ok: false, error: err && (err.name === 'TimeoutError' || err.name === 'AbortError') ? 'timeout' : 'unreachable' };
    }
    if (!res.ok) return { ok: false, error: statusError(res.status) };
    let text;
    try {
        text = await res.text();
    } catch {
        return { ok: false, error: 'unreachable' };
    }
    if (text.length > MAX_BODY_BYTES) return { ok: false, error: 'bad_response' };
    try {
        const data = JSON.parse(text);
        return data && typeof data === 'object' ? { ok: true, data } : { ok: false, error: 'bad_response' };
    } catch {
        return { ok: false, error: 'bad_response' };
    }
}

function finite(n) {
    return typeof n === 'number' && Number.isFinite(n) ? n : null;
}

/** fal: `credits.current_balance` in `credits.currency` (USD). */
export async function readFalBalance(key, fetcher = fetch) {
    if (typeof key !== 'string' || !key.trim()) return { ok: false, error: 'not_configured' };
    const r = await readJson(fetcher, FAL_BILLING_URL, { Authorization: `Key ${key.trim()}` });
    if (!r.ok) return r;
    const credits = r.data.credits;
    const balance = finite(credits && credits.current_balance);
    if (balance === null || typeof credits.currency !== 'string') return { ok: false, error: 'bad_response' };
    return { ok: true, balance, unit: credits.currency };
}

/** kie: `data` is the remaining credits; `code` other than 200 is a failure even on HTTP 200. */
export async function readKieBalance(key, fetcher = fetch) {
    if (typeof key !== 'string' || !key.trim()) return { ok: false, error: 'not_configured' };
    const r = await readJson(fetcher, KIE_CREDIT_URL, { Authorization: `Bearer ${key.trim()}` });
    if (!r.ok) return r;
    const code = r.data.code;
    if (code !== 200) {
        if (code === 401) return { ok: false, error: 'auth_failed' };
        if (code === 429) return { ok: false, error: 'rate_limited' };
        if (typeof code === 'number' && code >= 500) return { ok: false, error: 'unavailable' };
        return { ok: false, error: 'bad_response' };
    }
    const balance = finite(r.data.data);
    if (balance === null) return { ok: false, error: 'bad_response' };
    return { ok: true, balance, unit: 'credits' };
}

/** OpenRouter: purchased minus used, both in USD. */
export async function readOpenrouterBalance(key, fetcher = fetch) {
    if (typeof key !== 'string' || !key.trim()) return { ok: false, error: 'not_configured' };
    const r = await readJson(fetcher, OPENROUTER_CREDITS_URL, { Authorization: `Bearer ${key.trim()}` });
    if (!r.ok) return r;
    const d = r.data.data;
    const total = finite(d && d.total_credits);
    const used = finite(d && d.total_usage);
    if (total === null || used === null) return { ok: false, error: 'bad_response' };
    return { ok: true, balance: total - used, unit: 'USD' };
}

/** The providers the watch covers, in report order. GrsAI is not here: see the header. */
export const PROVIDERS = Object.freeze([
    { id: 'fal', keyVar: 'FAL_BILLING_KEY', floorVar: 'PROVIDER_BALANCE_FLOOR_FAL_USD', defaultFloor: 20, unit: 'USD', read: readFalBalance },
    { id: 'kie', keyVar: 'KIE_BALANCE_API_KEY', floorVar: 'PROVIDER_BALANCE_FLOOR_KIE_CREDITS', defaultFloor: 4000, unit: 'credits', read: readKieBalance },
    { id: 'openrouter', keyVar: 'OPENROUTER_MANAGEMENT_KEY', floorVar: 'PROVIDER_BALANCE_FLOOR_OPENROUTER_USD', defaultFloor: 10, unit: 'USD', read: readOpenrouterBalance },
]);

/** The floor for a provider: its variable when set, else the default in PROVIDERS. */
export function floorFor(provider, env) {
    const raw = env[provider.floorVar];
    if (raw === undefined || raw === '') return provider.defaultFloor;
    const n = Number(raw);
    return Number.isFinite(n) && n >= 0 ? n : NaN;
}

/**
 * Read every provider and assess it against its floor.
 * @returns {Promise<Array<{id:string, state:'ok'|'low'|'unreadable', floor:number, unit:string, reading:object}>>}
 */
export async function checkAll(env, fetcher = fetch) {
    return Promise.all(PROVIDERS.map(async (p) => {
        const reading = await p.read(env[p.keyVar], fetcher);
        const floor = floorFor(p, env);
        return { id: p.id, state: assess(reading, floor), floor, unit: p.unit, reading };
    }));
}

/**
 * One line per provider. Figures stay out unless asked for: the repo and its
 * Actions logs are public, and an issue body is too, so the default report
 * carries the verdict and the floor only.
 */
export function reportLines(results, { showFigures = false } = {}) {
    return results.map((r) => {
        const tag = r.state === 'ok' ? 'ok        ' : r.state === 'low' ? 'LOW       ' : 'UNREADABLE';
        const floor = Number.isFinite(r.floor) ? `floor ${r.floor} ${r.unit}` : `floor invalid (${r.unit})`;
        if (r.state === 'unreadable') {
            const why = r.reading && r.reading.ok ? 'floor is not a non-negative number' : ERRORS[r.reading && r.reading.error] || 'could not read';
            return `${tag} ${r.id.padEnd(10)} could not read balance: ${why}; ${floor}`;
        }
        const figure = showFigures ? ` (balance ${r.reading.balance} ${r.reading.unit})` : '';
        return `${tag} ${r.id.padEnd(10)} ${r.state === 'low' ? 'at or under' : 'above'} ${floor}${figure}`;
    });
}

/** Exit 0 all above floor, 1 any low, 2 none low but one unreadable. */
export function exitCode(results) {
    if (results.some((r) => r.state === 'low')) return 1;
    if (results.some((r) => r.state === 'unreadable')) return 2;
    return 0;
}
