/**
 * Supabase Database Webhook receiver — `auth.users` INSERT / UPDATE.
 *
 * Configured in Supabase dashboard:
 *   Table: auth.users
 *   Events: INSERT
 *   URL: https://<host>/api/webhook/supabase
 *   HTTP Headers: Authorization: Bearer <SUPABASE_WEBHOOK_SIGNING_SECRET>
 *
 * On a fresh signup we call the `signup_grant` Postgres RPC to atomically:
 *   1. Create the users row (idempotent on auth_id)
 *   2. Grant the ADR-0005 §4 free-tier 50 credits
 *
 * Every incoming event is deduped via the `webhook_events` table using the
 * (source, external_id) unique index. Replays are silent no-ops.
 *
 * The route is intentionally POST-only, JSON-only, and constant-time on
 * the shared-secret compare. It never echoes the raw payload back to the
 * client — errors are generic.
 */

import { NextResponse } from 'next/server';

const SOURCE = 'supabase:auth.users';

export async function POST(req) {
    const secret = process.env.SUPABASE_WEBHOOK_SIGNING_SECRET;
    const supabaseUrl = process.env.SUPABASE_URL;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!secret || !supabaseUrl || !serviceKey) {
        // Fail-closed — a misconfigured deployment must not accept webhooks.
        return json(503, { error: 'webhook not configured' });
    }

    // Shared-secret authenticate the caller.
    const authHeader = req.headers.get('authorization') || '';
    const provided = authHeader.toLowerCase().startsWith('bearer ')
        ? authHeader.slice(7).trim()
        : '';
    if (!constantTimeEqual(provided, secret)) {
        return json(401, { error: 'unauthorized' });
    }

    // Parse — reject anything that isn't Supabase's Database Webhook shape.
    let event;
    try {
        event = await req.json();
    } catch {
        return json(400, { error: 'invalid json' });
    }
    if (!event || typeof event !== 'object' || event.type !== 'INSERT' || !event.record) {
        // We only care about INSERTs to auth.users right now. Everything
        // else is a 200-noop so Supabase's webhook UI doesn't retry us
        // forever for events we don't intend to handle.
        return json(200, { ok: true, skipped: true });
    }

    const record = event.record;
    const authId = record.id;
    const email = record.email;
    if (typeof authId !== 'string' || !authId) {
        return json(400, { error: 'missing record.id' });
    }

    // Dedup via webhook_events(source, external_id). External id = auth
    // user id — one signup event per user, ever.
    // We rely on the UNIQUE (source, external_id) constraint from the
    // schema to make the insert either succeed (fresh) or fail with
    // 23505 (dup). No SELECT-then-INSERT race.
    const dedupInsert = await fetchSupabase(supabaseUrl, serviceKey, {
        method: 'POST',
        path: '/rest/v1/webhook_events',
        headers: { Prefer: 'return=representation,resolution=ignore-duplicates' },
        body: {
            source: SOURCE,
            external_id: authId,
            payload: event,
        },
    });
    // Prefer: resolution=ignore-duplicates returns 201 with empty body on
    // duplicate. We treat both 201 and 200 as "we own this event".
    if (dedupInsert.status !== 201 && dedupInsert.status !== 200) {
        // Log server-side, return generic to caller.
        console.error('[supabase-webhook] dedup insert failed:', dedupInsert.status, await safeText(dedupInsert));
        return json(500, { error: 'internal' });
    }
    // If dedup returned no body, it was a duplicate → silent success.
    let insertedBody;
    try {
        insertedBody = await dedupInsert.json();
    } catch {
        insertedBody = [];
    }
    if (Array.isArray(insertedBody) && insertedBody.length === 0) {
        return json(200, { ok: true, duplicate: true });
    }

    // Fresh event — call the signup grant RPC.
    const rpc = await fetchSupabase(supabaseUrl, serviceKey, {
        method: 'POST',
        path: '/rest/v1/rpc/signup_grant',
        body: { p_auth_id: authId, p_email: email || `${authId}@no-email.veyrnox.ai` },
    });
    if (!rpc.ok) {
        console.error('[supabase-webhook] signup_grant failed:', rpc.status, await safeText(rpc));
        return json(500, { error: 'internal' });
    }

    // Mark the webhook event as processed.
    await fetchSupabase(supabaseUrl, serviceKey, {
        method: 'PATCH',
        path: `/rest/v1/webhook_events?source=eq.${encodeURIComponent(SOURCE)}&external_id=eq.${encodeURIComponent(authId)}`,
        body: { processed_at: new Date().toISOString() },
    });

    return json(200, { ok: true });
}

// ─── helpers ────────────────────────────────────────────────────────────────

function json(status, body) {
    return NextResponse.json(body, { status });
}

function constantTimeEqual(a, b) {
    if (typeof a !== 'string' || typeof b !== 'string') return false;
    if (a.length !== b.length) return false;
    let diff = 0;
    for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
    return diff === 0;
}

/**
 * Minimal Supabase REST client used only inside this webhook. We do not
 * ship @supabase/supabase-js in the middleware/webhook layer because it
 * carries an isomorphic-fetch shim we don't need — fetch is native in
 * the Worker runtime.
 */
async function fetchSupabase(supabaseUrl, serviceKey, { method, path, headers = {}, body }) {
    const url = new URL(path, supabaseUrl).toString();
    const init = {
        method,
        headers: {
            apikey: serviceKey,
            Authorization: `Bearer ${serviceKey}`,
            'Content-Type': 'application/json',
            ...headers,
        },
    };
    if (body !== undefined) init.body = JSON.stringify(body);
    return fetch(url, init);
}

async function safeText(res) {
    try {
        const t = await res.text();
        return t.slice(0, 200);
    } catch {
        return '';
    }
}
