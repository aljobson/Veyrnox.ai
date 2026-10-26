import { rpc, select, envConfig } from '../packages/db/supabase-client.js';
import { presignGetUrl, presignPutUrl, getObject, sha256Hex, envConfig as storageConfig } from '../packages/adapters/r2.js';
import { readFilmMasterBytes } from './filmMasterBytes.js';
import { inspectEditorRender } from './editorRenderInspection.js';
import { fetchWithTimeout } from './fetchWithTimeout.js';
import { signEditorRenderBody, TIMESTAMP_HEADER, SIGNATURE_HEADER } from './editorServerRenderSigning.js';
import { dedup, markProcessed } from './providerCompletion.js';
import { UUID_RE } from './editorServerRender.js';

export function editorServerRenderDeps({ env = process.env, cfg = envConfig(), r2cfg = storageConfig() } = {}) {
    const runner = async (path, payload) => {
        const body = JSON.stringify(payload), timestamp = Math.floor(Date.now() / 1000);
        // The stage and error class name (never a message, body or secret) say where a refused submit failed.
        let stage = 'url';
        try {
            const target = new URL(path, env.EDITOR_RENDER_RUNNER_BASE);
            stage = 'sign';
            const signature = await signEditorRenderBody(env.EDITOR_RENDER_SIGNING_SECRET, path, body, timestamp);
            stage = 'fetch';
            const response = await fetchWithTimeout(target, {
                method: 'POST', body, redirect: 'error', headers: {
                    'content-type': 'application/json', [TIMESTAMP_HEADER]: String(timestamp), [SIGNATURE_HEADER]: signature,
                },
            }, 20000);
            stage = 'body';
            return response.ok ? { ok: true, data: await response.json() } : { ok: false, error: `runner_${response.status}` };
        } catch (e) {
            const name = String(e?.name || 'error').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 14);
            return { ok: false, error: `runner_transport_${stage}_${name}` };
        }
    };
    return {
        secret: env.EDITOR_RENDER_SIGNING_SECRET,
        rpc: (name, args) => rpc(name, args, cfg),
        job: async id => {
            if (!UUID_RE.test(String(id))) return null;
            const rows = await select('jobs', { filter: `id=eq.${id}&provider=eq.concat-render&limit=1` }, cfg);
            return rows?.[0] || null;
        },
        jobs: async () => {
            // Closed cleanup candidates cannot crowd live recovery out of its batch.
            const [live, cleanup] = await Promise.all([
                select('jobs', { filter: 'provider=eq.concat-render&state=in.(SUBMITTED,FAILED)&order=created_at.asc&limit=100' }, cfg),
                select('jobs', { filter: 'provider=eq.concat-render&state=eq.REFUNDED&deleted_at=is.null&inputs->>cleanup_queued=is.null&inputs->>cleanup_skipped=is.null&order=created_at.asc&limit=25' }, cfg),
            ]);
            return [...live, ...cleanup];
        },
        runner: {
            run: async body => {
                const result = await runner('/run', { ...body, callback_url: new URL('/api/webhook/editor-render', env.PUBLIC_HOST).href });
                return result.error === 'runner_429' ? { ok: false, error: 'render_busy' } : result;
            },
            cancel: job_id => runner('/cancel', { job_id }),
            states: job_ids => runner('/runs', { job_ids }),
        },
        signGet: key => presignGetUrl(key, 900, r2cfg),
        signPut: (key, size) => presignPutUrl(key, 'video/mp4', 900, r2cfg, size),
        get: key => getObject(key, r2cfg),
        inspect: inspectEditorRender, sha256: sha256Hex,
        readBytes: (body, size) => readFilmMasterBytes(body, size, AbortSignal.timeout(30000)),
        dedup: (id, payload) => dedup(cfg, 'editor-render', id, payload),
        processed: id => markProcessed(cfg, 'editor-render', id),
    };
}
