#!/usr/bin/env node
// After a production deploy: does the Worker still answer on its own domain
// only? wrangler.jsonc turns the workers.dev route and Preview URLs off
// (ADR-0078). wrangler applies both on `wrangler deploy` and nowhere else, so
// a deploy from a checkout that predates those two keys turns them back on
// without saying so. This reads the setting back and changes nothing.
//
// Always exits 0. By the time it runs the release is live, and neither a red
// job nor a rollback would change the setting. deploy-production reports the
// state written to GITHUB_OUTPUT instead.
import { appendFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const API = 'https://api.cloudflare.com/client/v4';
const ATTEMPTS = 3;
const RETRY_DELAY_MS = 5_000;
const TIMEOUT_MS = 15_000;

/**
 * Read the answer of GET /accounts/{id}/workers/scripts/{name}/subdomain:
 * `{ success, result: { enabled, previews_enabled } }`, both booleans.
 * Anything that does not say on or off for both is unknown, never off.
 * @returns {{state: 'closed' | 'open' | 'unknown', detail: string}}
 */
export function assessSubdomain(body) {
    const result = body && body.success === true ? body.result : null;
    if (!result || typeof result !== 'object') return { state: 'unknown', detail: 'the API answer had no result' };
    const on = [];
    if (result.enabled === true) on.push('the workers.dev route is on');
    if (result.previews_enabled === true) on.push('Preview URLs are on');
    if (on.length > 0) return { state: 'open', detail: on.join(' and ') };
    if (result.enabled === false && result.previews_enabled === false) {
        return { state: 'closed', detail: 'the workers.dev route and Preview URLs are off' };
    }
    return { state: 'unknown', detail: 'the API answer did not say on or off for both settings' };
}

async function readOnce({ accountId, workerName, token, fetchImpl }) {
    const url = `${API}/accounts/${encodeURIComponent(accountId)}/workers/scripts/${encodeURIComponent(workerName)}/subdomain`;
    const res = await fetchImpl(url, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(TIMEOUT_MS) });
    // The status only. The body of a refusal is not repeated into a public log.
    if (!res.ok) return { state: 'unknown', detail: `the API answered ${res.status}` };
    return assessSubdomain(await res.json());
}

/** Never throws: what cannot be read is reported as unknown. */
export async function checkWorkersDev({ accountId, workerName, token, fetchImpl = fetch, attempts = ATTEMPTS, delayMs = RETRY_DELAY_MS }) {
    if (!accountId || !workerName || !token) {
        return { state: 'unknown', detail: 'CLOUDFLARE_ACCOUNT_ID, WORKER_NAME or CLOUDFLARE_API_TOKEN is not set' };
    }
    let last;
    for (let attempt = 1; attempt <= attempts; attempt++) {
        try {
            last = await readOnce({ accountId, workerName, token, fetchImpl });
        } catch (error) {
            last = { state: 'unknown', detail: `the API could not be read (${(error && error.name) || 'Error'})` };
        }
        if (last.state !== 'unknown') return last;
        if (attempt < attempts) await new Promise((r) => setTimeout(r, delayMs));
    }
    return last;
}

/** One log line; GitHub shows `::error::` and `::warning::` on the run page. */
export function annotation(worker, { state, detail }) {
    if (state === 'closed') return `${worker}: ${detail}.`;
    if (state === 'open') return `::error::${worker}: ${detail}. wrangler.jsonc turns both off (ADR-0078).`;
    return `::warning::Could not check workers.dev for ${worker}: ${detail}.`;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
    const outcome = await checkWorkersDev({
        accountId: process.env.CLOUDFLARE_ACCOUNT_ID,
        workerName: process.env.WORKER_NAME,
        token: process.env.CLOUDFLARE_API_TOKEN,
    });
    console.log(annotation(process.env.WORKER_NAME || 'the Worker', outcome));
    if (process.env.GITHUB_OUTPUT) {
        appendFileSync(process.env.GITHUB_OUTPUT, `state=${outcome.state}\ndetail=${outcome.detail}\n`);
    }
}
