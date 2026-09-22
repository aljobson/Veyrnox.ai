/**
 * Real I/O for the Auto Short orchestrator (lib/autoShort.js `Deps`).
 *
 * Every outbound target is a constant or our own host: Supabase, fal's queue,
 * kie's API, OpenRouter's API, R2. Callback URLs are built from PUBLIC_HOST,
 * never from a request (CLAUDE.md, webhooks and SSRF).
 */

import { rpc, select } from '../packages/db/supabase-client.js';
import { submitJob } from '../packages/adapters/fal.js';
import * as kie from '../packages/adapters/kie.js';
import { OPENROUTER_BASE } from '../packages/adapters/openrouter.js';
import { copyUrlToR2 } from '../packages/adapters/r2Copy.js';
import { putObject, presignGetUrl } from '../packages/adapters/r2.js';
import { fetchWithTimeout } from './fetchWithTimeout.js';

const ID_RE = /^[A-Za-z0-9._-]{1,128}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PRESIGN_SECONDS = 15 * 60;
const CHAT_TIMEOUT_MS = 45_000;
const STEP_COLUMNS = 'job_id,step,ordinal,provider,provider_endpoint,provider_job_id,state,attempts,output_r2_key,output_text';

/** The step a provider callback names, or null. Never reads ids from a payload body. */
export async function findStep(cfg, provider, providerJobId) {
    if (!ID_RE.test(String(providerJobId || ''))) return null;
    const rows = await select('job_steps', {
        columns: STEP_COLUMNS,
        filter: `provider=eq.${encodeURIComponent(provider)}&provider_job_id=eq.${encodeURIComponent(providerJobId)}&limit=1`,
    }, cfg);
    return Array.isArray(rows) && rows[0] ? rows[0] : null;
}

/**
 * @param {object} env
 * @param {{supabaseUrl:string, serviceRoleKey:string}} env.cfg
 * @param {object} env.r2cfg
 * @param {string} env.publicHost
 * @param {string} env.falKey
 * @param {string} env.kieKey
 * @param {string} env.openrouterKey
 * @returns {import('./autoShort.js').Deps}
 */
export function runtimeDeps({ cfg, r2cfg, publicHost, falKey, kieKey, openrouterKey }) {
    const hook = (path) => new URL(path, publicHost).toString();
    return {
        rpc: (name, args) => rpc(name, args, cfg),
        steps: async (jobId) => {
            if (!UUID_RE.test(String(jobId))) return [];
            const rows = await select('job_steps', { columns: STEP_COLUMNS, filter: `job_id=eq.${jobId}` }, cfg);
            return Array.isArray(rows) ? rows : [];
        },
        job: async (jobId) => {
            if (!UUID_RE.test(String(jobId))) return null;
            const rows = await select('jobs', { columns: 'id,user_id,credits,state', filter: `id=eq.${jobId}&limit=1` }, cfg);
            return Array.isArray(rows) && rows[0] ? rows[0] : null;
        },
        chat: async (body) => {
            try {
                const res = await fetchWithTimeout(`${OPENROUTER_BASE}/api/v1/chat/completions`, {
                    method: 'POST',
                    headers: { Authorization: `Bearer ${openrouterKey}`, 'Content-Type': 'application/json' },
                    body: JSON.stringify(body),
                }, CHAT_TIMEOUT_MS);
                if (!res.ok) {
                    console.error('[auto-short] script request', res.status);
                    return { ok: false, error: `openrouter ${res.status}` };
                }
                const data = await res.json();
                const content = data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
                return typeof content === 'string' ? { ok: true, content } : { ok: false, error: 'no content' };
            } catch (err) {
                console.error('[auto-short] script request failed:', err && err.message);
                return { ok: false, error: 'transport' };
            }
        },
        submit: (provider, endpoint, inputs, jobId) => {
            const job = { job_id: jobId, provider_endpoint: endpoint, inputs };
            if (provider === 'fal') return submitJob(job, { falKey, webhookBaseUrl: hook('/api/webhook/fal') });
            if (provider === 'kie') return kie.submitTask(job, { apiKey: kieKey, callbackUrl: hook('/api/webhook/kie') });
            return Promise.resolve({ ok: false, error: `no submit for ${provider}` });
        },
        copy: (url, key, provider, opts = {}) => copyUrlToR2(url, key, r2cfg, { provider, expectMp4: !!opts.expectMp4 }),
        put: (key, text, contentType) => putObject(key, new TextEncoder().encode(text), contentType, r2cfg),
        presign: async (key) => (await presignGetUrl(key, PRESIGN_SECONDS, r2cfg)).url,
    };
}

/** Provider keys the pipeline needs; null when any is missing. */
export function runtimeKeys(env = process.env) {
    const keys = { falKey: env.FAL_KEY, kieKey: env.KIE_API_KEY, openrouterKey: env.OPENROUTER_API_KEY };
    return Object.values(keys).every(Boolean) ? keys : null;
}
