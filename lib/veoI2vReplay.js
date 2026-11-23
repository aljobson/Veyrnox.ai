import { select } from '../packages/db/supabase-client.js';
import { templateRequestFingerprint } from './templateRequestFingerprint.js';
import { veoI2vOffer } from './veoI2v.js';

// Capture the caller's request before prompt transforms, filtering or signed source URLs mutate it.
// Ordinary text-only Veo jobs retain their existing ledger replay path.
export async function veoI2vFingerprint(modelId, body) {
    if (!veoI2vOffer(modelId) || !(body.source_key !== undefined || body.source_keys?.length
        || body.source_assets?.length || body.references?.length || body.inputs?.image_url !== undefined
        || body.inputs?.video_url !== undefined)) return null;
    return templateRequestFingerprint({
        model_id: modelId, inputs: body.inputs, references: body.references,
        source_keys: body.source_keys, source_key: body.source_key, source_assets: body.source_assets, consent: body.consent,
        template_id: body.template_id, preset: body.preset, template_swap: body.template_swap, template_clip: body.template_clip, swap: body.swap,
    });
}

export async function replayVeoI2v(authId, modelId, key, hash, cfg) {
    try {
        const users = await select('users', { columns: 'id', filter: `auth_id=eq.${encodeURIComponent(authId)}`, limit: 1 }, cfg);
        if (!Array.isArray(users)) throw new Error('invalid user lookup');
        if (!users.length) return null;
        if (!users[0]?.id) throw new Error('invalid user');
        const jobs = await select('jobs', { columns: 'id,model_id,inputs',
            filter: `user_id=eq.${encodeURIComponent(users[0].id)}&idempotency_key=eq.${encodeURIComponent(key)}`, limit: 1 }, cfg);
        if (!Array.isArray(jobs)) throw new Error('invalid job lookup');
        if (!jobs.length) return null;
        const job = jobs[0];
        if (!job?.id || job.model_id !== modelId || job.inputs?.veo_i2v?.request_hash !== hash) {
            return { status: 409, body: { error: 'idempotency_conflict' } };
        }
        return { status: 200, body: { job_id: job.id, idempotent: true } };
    } catch { return { status: 503, body: { error: 'admission_unknown' } }; }
}
