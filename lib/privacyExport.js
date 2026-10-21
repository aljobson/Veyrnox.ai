import { NextResponse } from 'next/server';
import { rpc } from '../packages/db/supabase-client.js';
import { ledgerKind } from './ledgerKind.js';

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/;
export const EXPORT_SECTIONS = Object.freeze([
    'profile', 'credit_history', 'top_ups', 'credit_subscriptions', 'publish_subscriptions',
    'creations', 'chat_folders', 'chat_personas', 'chat_threads', 'publish_brands',
    'publish_connections', 'publish_posts', 'saved_titles', 'series_follows', 'creator_follows',
    'watch_progress', 'votes', 'comments', 'blocks', 'sanctions', 'appeals', 'reports',
]);
export const privacyExportEnabled = (env = process.env) => env.PRIVACY_EXPORT_ENABLED === 'true';
export const exportJson = (body, status = 200, headers = {}) => NextResponse.json(body, {
    status, headers: { 'Cache-Control': 'no-store', ...headers },
});

export function exportCursor(query) {
    const section = query.get('section'), after = query.get('after'), key = query.get('key'), thread = query.get('thread');
    if (!EXPORT_SECTIONS.includes(section) && section !== 'chat_messages') throw new Error('invalid_request');
    if (section === 'chat_messages') {
        if (!thread || !UUID_RE.test(thread) || key !== null ||
            (after !== null && (!/^[0-9]{1,19}$/.test(after) || BigInt(after) > 9223372036854775807n))) throw new Error('invalid_request');
    } else {
        if (thread !== null || (after === null) !== (key === null) ||
            (section === 'profile' && after !== null)) throw new Error('invalid_request');
        if (after !== null) {
            const validAfter = section === 'watch_progress' ? UUID_RE.test(after) : ISO.test(after) && Number.isFinite(Date.parse(after));
            const validKey = ['creator_follows', 'blocks'].includes(section) ? /^[0-9a-f]{64}$/.test(key) : UUID_RE.test(key);
            if (!validAfter || !validKey) throw new Error('invalid_request');
        }
    }
    return { p_section: section, p_thread_id: thread, p_after: after, p_key: key };
}
export function exportLedgerRow({ reason, ...row }) {
    return { ...row, kind: ledgerKind(reason, row.delta) };
}
export async function exportPageLimit(authId, cfg) {
    if (process.env.ACCOUNT_READ_RATE_LIMIT_ENABLED !== 'true') return null;
    let rate;
    try { rate = await rpc('consume_account_read_request', { p_auth_id: authId }, cfg); } catch { /* fail closed */ }
    if (rate?.ok === true) return null;
    if (rate?.code === 'NOT_FOUND') return exportJson({ error: 'export_not_found' }, 404);
    if (rate?.code === 'RATE_LIMITED') {
        const retry = Number.isInteger(rate.retry_after_seconds) ? Math.max(1, Math.min(60, rate.retry_after_seconds)) : 60;
        return exportJson({ error: 'read_throttled', retry_after_seconds: retry }, 429, { 'Retry-After': String(retry) });
    }
    return exportJson({ error: 'rate_limit_unavailable' }, 503, { 'Retry-After': '30' });
}
