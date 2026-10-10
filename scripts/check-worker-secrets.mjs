// Preserve secret names across production deployments. Never log binding values.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// One failed read of the Cloudflare API must not fail a deploy or roll back a
// healthy one (#753), so a read that may pass a moment later is made again: a
// 404 (a version uploaded seconds ago is not always readable yet), 408, 429,
// any 5xx, a timeout, a network error. 401, 403, any other status and an
// answer of the wrong shape are final. What still cannot be read fails closed.
const RETRY_DELAYS_MS = [1_000, 2_000, 4_000, 8_000];
const TRY_TIMEOUT_MS = 10_000;
// For the whole check, both reads together: the longest a deploy that cannot
// be checked stays live before the rollback starts.
const BUDGET_MS = 45_000;

/** The live Worker could not be read, so its bindings were not checked. */
class Unreadable extends Error {}

/** One line that says which it was: could not read, or names missing. */
export function failureLine(error) {
    return error instanceof Unreadable
        ? `Secret binding check could not read the live Worker, so the bindings were NOT checked: ${error.message}`
        : `Secret binding check failed: ${error.message}`;
}

export function secretNames(version) {
    const bindings = version?.resources?.bindings;
    if (!Array.isArray(bindings)) throw new Unreadable('Worker version bindings unavailable');
    return bindings.filter((b) => ['secret_text', 'secret_key'].includes(b.type)).map((b) => b.name).sort();
}

export function assertPreserved(required, versions) {
    if (!Array.isArray(required) || !required.every((name) => typeof name === 'string') || versions.length === 0) {
        throw new Error('Secret baseline or live versions unavailable');
    }
    for (const version of versions) {
        const names = new Set(secretNames(version));
        const missing = required.filter((name) => !names.has(name));
        if (missing.length) throw new Error(`Live Worker is missing secret bindings: ${missing.join(', ')}`);
    }
}

// The name of what went wrong, never its message: that may repeat the URL.
// A refused connection keeps its code one level further down.
function errorName(error) {
    const name = error?.cause?.code ?? error?.cause?.errors?.[0]?.code ?? error?.name;
    return typeof name === 'string' && /^\w{1,40}$/.test(name) ? name : 'Error';
}

export async function liveVersions({ accountId, workerName, token, fetchImpl = fetch, delaysMs = RETRY_DELAYS_MS,
    tryTimeoutMs = TRY_TIMEOUT_MS, budgetMs = BUDGET_MS, now = Date.now,
    sleep = (ms) => new Promise((r) => setTimeout(r, ms)), log = console.log }) {
    if (!accountId || !workerName || !token) throw new Unreadable('Cloudflare deployment credentials unavailable');
    const base = `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accountId)}/workers/scripts/${encodeURIComponent(workerName)}`;
    const started = now();
    const deadline = started + budgetMs;
    // One try: the result, or why not and whether another try could pass.
    // The status only. The body of a refusal is not repeated into a public log.
    async function once(path, timeoutMs) {
        let response;
        try {
            response = await fetchImpl(base + path, {
                headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(timeoutMs),
            });
        } catch (error) {
            return { why: `did not answer (${errorName(error)})`, again: true };
        }
        const { status } = response;
        if (!response.ok) return { why: `answered ${status}`, again: status === 404 || status === 408 || status === 429 || status >= 500 };
        let body;
        try {
            body = await response.json();
        } catch (error) {
            const notJson = error instanceof SyntaxError;
            return { why: notJson ? 'answered with a body that is not JSON' : `broke off mid-answer (${errorName(error)})`, again: !notJson };
        }
        if (body?.success !== true || !body.result) return { why: 'answered without a result', again: false };
        return { result: body.result };
    }
    async function get(path) {
        const what = `GET ${path}`;
        for (let tries = 1; ; tries++) {
            const left = deadline - now();
            if (left <= 0) throw new Unreadable(`${what} was not tried: the ${budgetMs / 1000} s for the whole check were used up`);
            const outcome = await once(path, Math.min(tryTimeoutMs, left));
            if (outcome.result) return outcome.result;
            if (!outcome.again) throw new Unreadable(`${what} ${outcome.why}; not tried again`);
            const delay = delaysMs[tries - 1];
            if (delay === undefined || now() + delay >= deadline) {
                throw new Unreadable(`${what} ${outcome.why}; gave up after ${tries} ${tries === 1 ? 'try' : 'tries'} over ${Math.round((now() - started) / 1000)} s`);
            }
            log(`::notice::${what} ${outcome.why} (try ${tries} of ${delaysMs.length + 1}); trying again in ${delay / 1000} s.`);
            await sleep(delay);
        }
    }
    const deployments = (await get('/deployments')).deployments;
    if (!Array.isArray(deployments) || !deployments.length) throw new Unreadable('Live deployment unavailable');
    const latest = [...deployments].sort((a, b) => Date.parse(b.created_on) - Date.parse(a.created_on))[0];
    const active = latest.versions?.filter((v) => v.percentage > 0);
    if (!active?.length || active.some((v) => !v.version_id)) throw new Unreadable('Live deployment versions unavailable');
    // One at a time, so a read that fails leaves no other still trying.
    const versions = [];
    for (const v of active) versions.push(await get(`/versions/${encodeURIComponent(v.version_id)}`));
    return versions;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
    try {
        const [mode, path] = process.argv.slice(2);
        if (!['capture', 'verify'].includes(mode) || !path) throw new Error('Expected capture|verify and baseline path');
        const versions = await liveVersions({ accountId: process.env.CLOUDFLARE_ACCOUNT_ID,
            workerName: process.env.WORKER_NAME, token: process.env.CLOUDFLARE_API_TOKEN });
        const required = mode === 'capture'
            ? [...new Set(versions.flatMap(secretNames))].sort()
            : JSON.parse(readFileSync(path, 'utf8'));
        assertPreserved(required, versions);
        if (mode === 'capture') writeFileSync(path, JSON.stringify(required), { mode: 0o600 });
        console.log(`Live Worker secret binding check passed (${required.length} names).`);
    } catch (error) {
        console.error(`::error::${failureLine(error)}`);
        process.exitCode = 1;
    }
}
