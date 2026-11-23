import { select } from '../packages/db/supabase-client.js';
import { templateRequestFingerprint } from './templateRequestFingerprint.js';
// Bind retries to the original request before expiring uploads or a paused catalog are consulted.
export const seedance25Fingerprint = body => templateRequestFingerprint({
    model_id: body.model_id, inputs: body.inputs, references: body.references,
    source_keys: body.source_keys, source_key: body.source_key, source_assets: body.source_assets, consent: body.consent,
});
export async function replaySeedance25(authId, modelId, key, hash, cfg) {
    try {
        const users = await select('users', { columns: 'id', filter: `auth_id=eq.${encodeURIComponent(authId)}`, limit: 1 }, cfg);
        if (!users?.[0]?.id) return null;
        const jobs = await select('jobs', { columns: 'id,model_id,inputs',
            filter: `user_id=eq.${encodeURIComponent(users[0].id)}&idempotency_key=eq.${encodeURIComponent(key)}`, limit: 1 }, cfg);
        if (!Array.isArray(jobs)) throw new Error();
        if (!jobs.length) return null;
        const job = jobs[0];
        if (!job.id || job.model_id !== modelId || job.inputs?.seedance25_billing?.request_hash !== hash) {
            return { status: 409, body: { error: 'idempotency_conflict' } };
        }
        return { status: 200, body: { job_id: job.id, idempotent: true } };
    } catch { return { status: 503, body: { error: 'admission_unknown' } }; }
}
