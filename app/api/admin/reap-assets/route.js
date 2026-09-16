/**
 * POST /api/admin/reap-assets — Worker consumer for the asset_reap_queue.
 *
 * Reads a batch from `public.asset_reap_queue`, deletes each r2_key from R2,
 * removes the queue row on success, otherwise bumps attempts + logs the error.
 *
 * Auth: shared secret `ADMIN_REAP_TOKEN` in header `x-veyrnox-admin-token`,
 * compared in constant time and throttled after repeated failures
 * (lib/adminThrottle.js). Not exposed to end users. Meant for a cron worker or
 * manual replay.
 *
 * Response: { processed, deleted, failed, remaining? }.
 */

import { NextResponse } from 'next/server';
import { rpc, envConfig } from '../../../../packages/db/supabase-client.js';
import { tokenMatches } from '../../../../lib/tokenMatches.js';
import { retryAfterSeconds, recordFailure } from '../../../../lib/adminThrottle.js';
import { fetchWithTimeout } from '../../../../lib/fetchWithTimeout.js';
import { deleteObject, isConfigured as r2IsConfigured, envConfig as r2EnvConfig } from '../../../../packages/adapters/r2.js';

const BATCH = 100;
const THROTTLE_BUCKET = 'reap-assets';

async function selectQueue(cfg, limit) {
    const url = new URL('/rest/v1/asset_reap_queue', cfg.supabaseUrl);
    url.searchParams.set('select', 'id,r2_key,attempts');
    url.searchParams.set('order', 'queued_at.asc');
    url.searchParams.set('limit', String(limit));
    const res = await fetchWithTimeout(url, {
        headers: {
            apikey: cfg.serviceRoleKey,
            Authorization: `Bearer ${cfg.serviceRoleKey}`,
        },
    });
    if (!res.ok) return { ok: false, error: `queue read ${res.status}` };
    return { ok: true, rows: await res.json() };
}

async function markSuccess(cfg, id) {
    const url = new URL('/rest/v1/asset_reap_queue', cfg.supabaseUrl);
    url.searchParams.set('id', `eq.${id}`);
    return fetchWithTimeout(url, {
        method: 'DELETE',
        headers: {
            apikey: cfg.serviceRoleKey,
            Authorization: `Bearer ${cfg.serviceRoleKey}`,
            Prefer: 'return=minimal',
        },
    });
}

async function markFail(cfg, id, attempts, err) {
    const url = new URL('/rest/v1/asset_reap_queue', cfg.supabaseUrl);
    url.searchParams.set('id', `eq.${id}`);
    return fetchWithTimeout(url, {
        method: 'PATCH',
        headers: {
            apikey: cfg.serviceRoleKey,
            Authorization: `Bearer ${cfg.serviceRoleKey}`,
            'Content-Type': 'application/json',
            Prefer: 'return=minimal',
        },
        body: JSON.stringify({ attempts: attempts + 1, last_error: String(err).slice(0, 500) }),
    });
}

export async function POST(req) {
    const token = process.env.ADMIN_REAP_TOKEN;
    if (!token) return NextResponse.json({ error: 'not_configured' }, { status: 503 });
    // The secret is compared before the throttle is consulted, so a caller
    // presenting the right token is never locked out. Throttling first would
    // let anyone stall the reaper by spending ten wrong guesses.
    if (!(await tokenMatches(req.headers.get('x-veyrnox-admin-token'), token))) {
        // Logged so Worker observability shows probing, not just silence.
        const seen = recordFailure(THROTTLE_BUCKET);
        const wait = retryAfterSeconds(THROTTLE_BUCKET);
        console.error('[reap-assets] unauthorized call, failures in window:', seen);
        if (wait) {
            return NextResponse.json({ error: 'too_many_requests' }, {
                status: 429,
                headers: { 'retry-after': String(wait) },
            });
        }
        return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }

    const cfg = envConfig();
    const r2cfg = r2EnvConfig();
    if (!cfg.supabaseUrl || !cfg.serviceRoleKey || !r2IsConfigured(r2cfg)) {
        return NextResponse.json({ error: 'not_configured' }, { status: 503 });
    }

    const q = await selectQueue(cfg, BATCH);
    if (!q.ok) {
        console.error('[reap-assets] queue read failed:', q.error);
        return NextResponse.json({ error: 'internal' }, { status: 502 });
    }

    let deleted = 0;
    let failed = 0;
    for (const row of q.rows) {
        try {
            const del = await deleteObject(row.r2_key, r2cfg);
            if (del.ok) {
                await markSuccess(cfg, row.id);
                deleted++;
            } else {
                await markFail(cfg, row.id, row.attempts, del.error);
                failed++;
            }
        } catch (err) {
            await markFail(cfg, row.id, row.attempts, err && err.message);
            failed++;
        }
    }

    return NextResponse.json({ processed: q.rows.length, deleted, failed });
}
