/**
 * Mobile push (ADR-0113). A per-minute sweep tells people their generation
 * finished or failed. It reads finished jobs and never writes to one: the
 * ledger and job state are untouched whatever happens here, and runPushSweep
 * never throws.
 *
 * Off until PUSH_NOTIFICATIONS_ENABLED is "true". Production vars are at the
 * binding budget, so the flag is set on staging only and absent (off) in
 * production, as with STORE_BILLING_ENABLED.
 */
import { rpc } from '../packages/db/supabase-client.js';
import { fetchWithTimeout } from './fetchWithTimeout.js';

// A constant, never derived from input. Expo's push service forwards to APNs and FCM.
export const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';
const EXPO_BATCH = 100;

export const PUSH_TOKEN_RE = /^Expo(?:nent)?PushToken\[[A-Za-z0-9_-]{8,64}\]$/;

export function pushEnabled(env = process.env) {
    return env.PUSH_NOTIFICATIONS_ENABLED === 'true';
}

function noun(modality) {
    const m = String(modality || '').toLowerCase();
    if (m.includes('video')) return 'video';
    if (m.includes('image')) return 'image';
    if (m.includes('audio') || m.includes('voice') || m.includes('music') || m.includes('speech')) return 'audio';
    return 'generation';
}

/**
 * The words on the lock screen. No prompt, no model name: a stranger holding
 * the phone learns only that something finished. `data` is for the app's router.
 */
export function buildMessage(item, token) {
    const failed = item.kind === 'job_failed';
    const what = noun(item.modality);
    const refunded = item.job_state === 'REFUNDED';
    return {
        to: token,
        title: failed ? `Your ${what} didn't finish` : `Your ${what} is ready`,
        body: failed
            ? (refunded ? 'Your credits were refunded.' : 'Open the app to see what happened.')
            : 'Open Veyrnox to see it.',
        sound: 'default',
        priority: 'high',
        channelId: 'jobs',
        data: { type: 'job', job_id: item.job_id, state: failed ? 'failed' : 'succeeded' },
        ttl: 3600,
    };
}

/**
 * Send one batch. Returns one ticket per message, in order:
 * { status: 'ok' } | { status: 'error', error: string, permanent: boolean }.
 * A transport or HTTP failure marks every ticket as a retryable error.
 */
export async function sendExpoBatch(messages, { accessToken, fetcher = fetchWithTimeout } = {}) {
    const fail = (error) => messages.map(() => ({ status: 'error', error, permanent: false }));
    let res;
    try {
        res = await fetcher(EXPO_PUSH_URL, {
            method: 'POST',
            headers: {
                Accept: 'application/json',
                'Content-Type': 'application/json',
                ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
            },
            body: JSON.stringify(messages),
        }, 10_000);
    } catch {
        return fail('expo_unreachable');
    }
    if (!res.ok) return fail(`expo_http_${res.status}`);
    let json;
    try { json = await res.json(); } catch { return fail('expo_bad_response'); }
    const data = Array.isArray(json?.data) ? json.data : null;
    if (!data || data.length !== messages.length) return fail('expo_bad_response');
    return data.map((t) => {
        if (t && t.status === 'ok') return { status: 'ok' };
        const code = String(t?.details?.error || 'expo_error').slice(0, 64);
        return { status: 'error', error: code, permanent: code === 'DeviceNotRegistered' };
    });
}

/**
 * One sweep. Enqueue finished jobs, claim a batch, send, record the outcome.
 * @returns {Promise<{ok:boolean, skipped?:boolean, queued?:number, claimed?:number, sent?:number, failed?:number}>}
 */
export async function runPushSweep({ env, cfg, fetcher } = {}) {
    if (!pushEnabled(env)) return { ok: true, skipped: true };
    try {
        const queued = await rpc('push_enqueue_job_events', { p_limit: 200 }, cfg);
        const batch = await rpc('push_claim_batch', { p_limit: 50, p_lease_seconds: 120 }, cfg);
        const items = Array.isArray(batch) ? batch : [];
        let sent = 0;
        let failed = 0;
        for (const item of items) {
            const tokens = Array.isArray(item.tokens) ? item.tokens : [];
            const messages = [];
            for (let i = 0; i < tokens.length; i += EXPO_BATCH) {
                messages.push(...tokens.slice(i, i + EXPO_BATCH).map((t) => buildMessage(item, t.token)));
            }
            const tickets = [];
            for (let i = 0; i < messages.length; i += EXPO_BATCH) {
                tickets.push(...await sendExpoBatch(messages.slice(i, i + EXPO_BATCH), { accessToken: env.EXPO_ACCESS_TOKEN, fetcher }));
            }
            const dead = tokens.filter((_, i) => tickets[i]?.permanent).map((t) => t.id);
            const anyOk = tickets.some((t) => t.status === 'ok');
            const allPermanent = tickets.length > 0 && tickets.every((t) => t.status === 'error' && t.permanent);
            const firstError = tickets.find((t) => t.status === 'error')?.error;
            const outcome = anyOk ? 'sent' : (allPermanent ? 'dead' : 'retry');
            if (anyOk) sent += 1; else failed += 1;
            await rpc('push_settle', { p_id: item.id, p_outcome: outcome, p_error: firstError || null, p_dead_token_ids: dead }, cfg);
        }
        await rpc('push_prune', {}, cfg);
        return { ok: true, queued: Number(queued) || 0, claimed: items.length, sent, failed };
    } catch (err) {
        // A broken push sweep is a missed notification, never a missed refund.
        console.error('[push-sweep] failed:', err && err.message);
        return { ok: false };
    }
}
