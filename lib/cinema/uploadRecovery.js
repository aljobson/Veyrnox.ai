import { rpc } from '../../packages/db/supabase-client.js';
import { streamConfig, readStreamVideo, mediaObservation, STREAM_UID } from './stream.js';

const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;

// Read bindings explicitly: scheduled events have no Next request environment.
// Recovery is independent of the creator-facing switches once uploads exist.
export async function recoverCinemaUploads(env, { rpcCall = rpc, readVideo = readStreamVideo } = {}) {
    const result = { ok: true, checked: 0, observed: 0, failed: 0 };
    const report = () => {
        if (result.checked || !result.ok) console.info(JSON.stringify({ event: 'cinema.upload_recovery', ...result }));
        return result;
    };
    // This separate deployment switch stays off until the migration is applied.
    if (env.CINEMA_UPLOAD_RECOVERY_ENABLED !== 'true') return { ...result, skipped: 'disabled' };
    const db = { supabaseUrl: env.SUPABASE_URL, serviceRoleKey: env.SUPABASE_SERVICE_ROLE_KEY };
    let cfg, items;
    const key = crypto.randomUUID();
    try {
        if (!db.supabaseUrl || !db.serviceRoleKey) throw Error('unconfigured');
        cfg = streamConfig(env);
        ({ items } = await rpcCall('claim_cinema_upload_checks', { p_key: key }, db));
        if (!Array.isArray(items) || items.length > 20 || items.some(item =>
            !UUID.test(item?.id || '') || typeof item.stream_uid !== 'string' || !STREAM_UID.test(item.stream_uid)) ||
            new Set(items.map(item => item.id)).size !== items.length) throw Error('invalid_claim');
    } catch {
        result.ok = false;
        result.failed = 1;
        return report();
    }
    // At most four provider reads at a time, twenty per invocation. Each read
    // has a ten-second deadline; each database call has an eight-second bound.
    for (let offset = 0; offset < items.length; offset += 4) {
        await Promise.all(items.slice(offset, offset + 4).map(async item => {
            result.checked++;
            let ok = false;
            try {
                const observedAt = new Date().toISOString();
                const video = await readVideo(item.stream_uid, cfg);
                if (video?.uid !== item.stream_uid) throw Error('mismatched_video');
                const observation = mediaObservation(video);
                if (observation) {
                    const saved = await rpcCall('observe_cinema_upload', { ...observation, p_observed_at: observedAt }, db);
                    if (saved?.ok !== true) throw Error('observation_failed');
                    result.observed++;
                }
                ok = true;
            } catch { /* Keep ambiguous/provider failures private and retry on a later run. */ }
            try {
                const saved = await rpcCall('finish_cinema_upload_check', { p_id: item.id, p_key: key, p_ok: ok }, db);
                if (saved?.ok !== true) ok = false;
            } catch { ok = false; }
            if (!ok) { result.failed++; result.ok = false; }
        }));
    }
    return report();
}
