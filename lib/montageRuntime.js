/**
 * Real I/O for the video-agent orchestrator (lib/montage.js `Deps`).
 *
 * The runner URL is a constant (MONTAGE_RUNNER_BASE, a Worker var), never
 * derived from input. Callback URLs are built from PUBLIC_HOST, never from a
 * request. Every runner request is signed (lib/montageSigning.js).
 */

import { rpc, select } from '../packages/db/supabase-client.js';
import { listObjects, presignPutUrl } from '../packages/adapters/r2.js';
import { fetchWithTimeout } from './fetchWithTimeout.js';
import { signRunnerBody, SIGNATURE_HEADER, TIMESTAMP_HEADER } from './montageSigning.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const RUNNER_TIMEOUT_MS = 20_000;

/** Signed POST to the runner. Never throws; the body is never logged. */
export async function callRunner(path, payload, { base, secret, fetchImpl = fetchWithTimeout, now = () => Math.floor(Date.now() / 1000) }) {
    const body = JSON.stringify(payload);
    const t = now();
    try {
        const res = await fetchImpl(new URL(path, base).toString(), {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                [TIMESTAMP_HEADER]: String(t),
                [SIGNATURE_HEADER]: await signRunnerBody(secret, body, t),
            },
            body,
        }, RUNNER_TIMEOUT_MS);
        if (!res.ok) {
            console.error('[video-agent] runner', path, res.status);
            return { ok: false, error: `runner_${res.status}` };
        }
        return { ok: true, data: await res.json().catch(() => ({})) };
    } catch (err) {
        console.error('[video-agent] runner transport:', path, err && err.message);
        return { ok: false, error: 'runner_transport' };
    }
}

/** Config or null when any piece is missing. */
export function runtimeConfig(env = process.env) {
    const c = { runnerBase: env.MONTAGE_RUNNER_BASE, runnerSecret: env.MONTAGE_SIGNING_SECRET, publicHost: env.PUBLIC_HOST };
    return Object.values(c).every(Boolean) ? c : null;
}

/** @returns {import('./montage.js').Deps & {presignPut:(key:string, contentType:string, seconds:number)=>Promise<string>}} */
export function montageDeps({ cfg, r2cfg, runnerBase, runnerSecret, publicHost }) {
    return {
        rpc: (name, args) => rpc(name, args, cfg),
        job: async (jobId) => {
            if (!UUID_RE.test(String(jobId))) return null;
            const rows = await select('jobs', { columns: 'id,user_id,credits,state', filter: `id=eq.${jobId}&limit=1` }, cfg);
            return Array.isArray(rows) && rows[0] ? rows[0] : null;
        },
        runner: {
            run: (req) => callRunner('/run', { ...req, callback_url: new URL('/api/webhook/montage', publicHost).toString() }, { base: runnerBase, secret: runnerSecret }),
            cancel: (runId) => callRunner('/cancel', { run_id: runId }, { base: runnerBase, secret: runnerSecret }),
        },
        head: async (key) => {
            const listed = await listObjects(key, r2cfg, { maxKeys: 1 });
            if (!listed.ok) return { ok: false, error: 'r2_unavailable' };
            const hit = listed.objects.find((o) => o.key === key);
            return hit ? { ok: true, size: hit.size } : { ok: false, error: 'missing' };
        },
        presignPut: async (key, contentType, seconds) => (await presignPutUrl(key, contentType, seconds, r2cfg)).url,
    };
}
