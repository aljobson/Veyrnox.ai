// Server-only adapter boundary. Preserve existing provider and orchestrator behavior.
import { submitJob } from '../adapters/fal.js';
import * as grsai from '../adapters/grsai.js';
import * as byteplus from '../adapters/byteplus.js';
import * as kie from '../adapters/kie.js';
import * as openrouter from '../adapters/openrouter.js';
import { checkInputs, shapePayload } from '../../lib/modelCapabilities.js';
import { envConfig } from '../db/supabase-client.js';
import { envConfig as r2EnvConfig, isConfigured as r2IsConfigured } from '../adapters/r2.js';
import { start as startAutoShort, parentRef } from '../../lib/autoShort.js';
import { TOPIC_RE } from '../../lib/autoShortSteps.js';
import { runtimeDeps, runtimeKeys } from '../../lib/autoShortRuntime.js';
import { start as startClipEdit, parentRef as clipEditRef } from '../../lib/clipEdit.js';

const PROVIDERS = {
    fal: {
        key: () => process.env.FAL_KEY,
        check: (record, _modelRow, inputs) => checkInputs(record, inputs),
        submit: (job, record, apiKey, publicHost, sources) => submitJob(
            { ...job, inputs: shapePayload(record, job.inputs, sources) },
            { falKey: apiKey, webhookBaseUrl: new URL('/api/webhook/fal', publicHost).toString() },
        ),
    },
    kie: {
        key: () => process.env.KIE_API_KEY,
        check: (record, modelRow, inputs) => {
            const own = checkInputs(record, inputs);
            if (!own.ok) return own;
            const target = kie.parseEndpoint(modelRow.provider_endpoint);
            return target ? kie.buildRequest(target, inputs) : { ok: false, error: 'provider_unsupported' };
        },
        submit: (job, _record, apiKey, publicHost) => kie.submitTask(job,
            { apiKey, callbackUrl: new URL('/api/webhook/kie', publicHost).toString() }),
    },
    grsai: {
        key: () => r2IsConfigured(r2EnvConfig()) ? process.env.GRSAI_API_KEY : null,
        check: (_record, modelRow, inputs) => grsai.buildRequest(modelRow.provider_endpoint, inputs),
        submit: (job, _record, apiKey) => grsai.submitTask(job, { apiKey }),
    },
    // BytePlus ModelArk (ADR-0058): polling only, so a job is only accepted
    // when R2 is configured for the sweep to copy the 24-hour output into.
    byteplus: {
        key: () => r2IsConfigured(r2EnvConfig()) ? process.env.BYTEPLUS_API_KEY : null,
        check: (_record, modelRow, inputs) => byteplus.buildRequest(modelRow.provider_endpoint, inputs),
        submit: (job, _record, apiKey) => byteplus.submitTask(job, { apiKey }),
    },
    openrouter: {
        key: () => process.env.OPENROUTER_API_KEY,
        check: (record, modelRow, inputs) => {
            const own = checkInputs(record, inputs);
            return own.ok ? openrouter.buildRequest(modelRow.provider_endpoint, inputs) : own;
        },
        submit: (job, _record, apiKey, publicHost) => openrouter.submitVideo(job,
            { apiKey, callbackUrl: new URL('/api/webhook/openrouter', publicHost).toString() }),
    },
    // Auto Short: no single provider call. The orchestrator writes the script,
    // then submits the voice and scenes; their webhooks drive the rest.
    veyrnox: {
        key: () => (runtimeKeys() && r2IsConfigured(r2EnvConfig()) ? 'configured' : null),
        check: (record, _modelRow, inputs) => {
            const own = checkInputs(record, inputs);
            if (!own.ok || record.edit) return own;
            return TOPIC_RE.test(inputs.topic) ? { ok: true } : { ok: false, error: 'inputs_invalid:topic' };
        },
        submit: async (job, record, _key, publicHost) => {
            const deps = runtimeDeps({ cfg: envConfig(), r2cfg: r2EnvConfig(), publicHost, ...runtimeKeys() });
            if (record.edit) {
                const r = await startClipEdit({ jobId: job.job_id, edit: job.inputs.edit }, deps);
                return r.ok ? { ok: true, providerJobId: clipEditRef(job.job_id) } : { ok: false, error: r.error, errorCode: r.error };
            }
            const r = await startAutoShort({ jobId: job.job_id, topic: job.inputs.topic }, deps);
            return r.ok ? { ok: true, providerJobId: parentRef(job.job_id) } : { ok: false, error: r.error, errorCode: r.error };
        },
    },
};

/** Registry membership, never prototype-chain lookup. */
export function providerFor(id) {
    return typeof id === 'string' && Object.prototype.hasOwnProperty.call(PROVIDERS, id) ? PROVIDERS[id] : null;
}
