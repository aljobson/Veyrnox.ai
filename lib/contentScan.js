import { rpc } from '../packages/db/supabase-client.js';
import { presignGetUrl } from '../packages/adapters/r2.js';
import { fetchWithTimeout } from './fetchWithTimeout.js';

export const DECISION = Object.freeze({ sexual: 0.80, 'violence/graphic': 0.80 });
export const IMAGE_CATEGORIES = Object.freeze(['sexual', 'violence', 'violence/graphic', 'self-harm', 'self-harm/intent', 'self-harm/instructions']);
const MODEL = 'omni-moderation-latest';

// sexual/minors is text-only: it cannot trigger an image decision or escalation.
export function decide(result) {
    const scores = result?.category_scores || {};
    const flagged = result?.categories || {};
    return Object.entries(DECISION).some(([key, threshold]) => scores[key] >= threshold)
        || IMAGE_CATEGORIES.some(key => key.startsWith('self-harm') && flagged[key] === true) ? 'hold' : 'clean';
}

export async function drainContentScans(cfg, r2cfg, env, {
    fetcher = fetchWithTimeout, chunk = 5, leaseSeconds = 120, budgetMs = 45000, now = Date.now,
} = {}) {
    if (env.CONTENT_SCAN_ENABLED !== 'true') {
        console.error('[content-scan] disabled or key missing');
        return { ok: true, skipped: 'not_configured' };
    }
    const started = now();
    await rpc('arm_content_scan_monitor', {}, cfg);
    if (!env.OPENAI_API_KEY) {
        console.error('[content-scan] key missing; monitoring armed');
        return { ok: false, skipped: 'not_configured' };
    }
    if (env.SOCIAL_HOLD_CHECKS_ENABLED !== 'true') {
        console.error('[content-scan] CONTENT_SCAN_ENABLED=true while SOCIAL_HOLD_CHECKS_ENABLED is not true: held images are excluded from new dispatch, but claimed targets are not re-checked until hold checks are on');
    }
    const out = { ok: true, claimed: 0, decided: 0, errors: 0 };
    let emptyClaims = 0;
    while (now() - started < budgetMs) {
        const rows = await rpc('claim_content_scans', { p_limit: chunk, p_lease_seconds: leaseSeconds }, cfg);
        if (!Array.isArray(rows) || !rows.length) {
            // A claim can consume a batch marking deleted assets unavailable.
            if (++emptyClaims >= 2) break;
            continue;
        }
        emptyClaims = 0;
        out.claimed += rows.length;
        // Soft budget: finish this chunk even if no further claim can be made.
        for (const row of rows) {
            if (Date.parse(row.lease_until) - now() < 15000) continue;
            try {
                const { url } = await presignGetUrl(row.r2_key, 900, r2cfg);
                const res = await fetcher('https://api.openai.com/v1/moderations', {
                    method: 'POST', headers: { Authorization: `Bearer ${env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
                    body: JSON.stringify({ model: MODEL, input: [{ type: 'image_url', image_url: { url } }] }),
                }, 10000);
                let verdict, scores, model = MODEL;
                if ([400, 413, 415].includes(res.status)) {
                    verdict = 'unavailable'; scores = { error: res.status };
                } else if (res.ok) {
                    const body = await res.json();
                    const result = body.results?.[0];
                    // Malformed successes retry like transport failures, never decide clean.
                    if (!result?.category_scores || !result?.categories || !IMAGE_CATEGORIES.every(k =>
                        Number.isFinite(result.category_scores[k]) && typeof result.categories[k] === 'boolean')) throw Error('invalid_result');
                    verdict = decide(result); scores = result.category_scores; model = body.model || MODEL;
                } else throw Error('provider_unavailable');
                const recorded = await rpc('record_content_scan', {
                    p_scan_id: row.id, p_claim_token: row.claim_token, p_verdict: verdict, p_scores: scores, p_model: model,
                }, cfg);
                if (recorded?.ok) out.decided++;
            } catch {
                out.errors++;
                console.error('[content-scan] failed scan', row.id);
            }
        }
    }
    console.error('[content-scan]', JSON.stringify(out));
    return out;
}
