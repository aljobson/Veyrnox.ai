// Preserve secret names across production deployments. Never log binding values.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export function secretNames(version) {
    const bindings = version?.resources?.bindings;
    if (!Array.isArray(bindings)) throw new Error('Worker version bindings unavailable');
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

export async function liveVersions({ accountId, workerName, token, fetchImpl = fetch }) {
    if (!accountId || !workerName || !token) throw new Error('Cloudflare deployment credentials unavailable');
    const base = `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accountId)}/workers/scripts/${encodeURIComponent(workerName)}`;
    async function get(path) {
        const response = await fetchImpl(base + path, {
            headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(15000),
        });
        if (!response.ok) throw new Error(`Cloudflare metadata read failed (${response.status})`);
        const body = await response.json();
        if (body.success !== true || !body.result) throw new Error('Cloudflare metadata unavailable');
        return body.result;
    }
    const deployments = (await get('/deployments')).deployments;
    if (!Array.isArray(deployments) || !deployments.length) throw new Error('Live deployment unavailable');
    const latest = [...deployments].sort((a, b) => Date.parse(b.created_on) - Date.parse(a.created_on))[0];
    const active = latest.versions?.filter((v) => v.percentage > 0);
    if (!active?.length || active.some((v) => !v.version_id)) throw new Error('Live deployment versions unavailable');
    return Promise.all(active.map((v) => get(`/versions/${encodeURIComponent(v.version_id)}`)));
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
        console.error(`::error::${error.message}`);
        process.exitCode = 1;
    }
}
