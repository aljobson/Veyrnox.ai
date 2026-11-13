// Shared by the three /api/v1/library-sync routes (ADR-0340).
import { NextResponse } from 'next/server';
import { rpc, envConfig } from '../../../../packages/db/supabase-client.js';
import { librarySyncEnabled } from '../../../../lib/librarySync.js';
import { isUuidLoose } from '../../../../lib/validate.js';

export const NO_STORE = { 'Cache-Control': 'no-store' };
export const fail = (error, status, extra = {}) => NextResponse.json({ error, ...extra }, { status, headers: NO_STORE });

export function gate(req) {
    const authId = req.headers.get('x-veyrnox-auth-id');
    if (!authId || !isUuidLoose(authId)) return { response: fail('not_authenticated', 401) };
    if (!librarySyncEnabled()) return { response: fail('not_found', 404) };
    const cfg = envConfig();
    if (!cfg.supabaseUrl || !cfg.serviceRoleKey) return { response: fail('gateway_not_configured', 503) };
    return { authId, cfg };
}

// Never logs the arguments: a draft holds the person's prompt.
export async function call(name, args, cfg) {
    try {
        return await rpc(name, args, cfg);
    } catch (err) {
        console.error(`[api/v1/library-sync] ${name} failed:`, err && err.message);
        return null;
    }
}

export function refused(result) {
    if (result?.error === 'account_not_found') return fail('account_not_found', 404);
    console.error('[api/v1/library-sync] refused:', result?.error);
    return fail('library_sync_unavailable', 502);
}
