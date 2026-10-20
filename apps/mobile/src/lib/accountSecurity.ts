import { AuthError } from './auth/supabaseAuth';

// Rules for the Account security screen. They mirror app/lib/accountSecurity.js and the web's
// OAuthGrantsPanel so a bad entry is caught before the request.
export const PASSWORD_MIN = 8;
export const PASSWORD_MAX = 72;
const NONCE_RE = /^[0-9]{6,10}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const validPassword = (value: string): boolean => value.length >= PASSWORD_MIN && value.length <= PASSWORD_MAX;
export const validNonce = (value: string): boolean => NONCE_RE.test(value);
export const validClientId = (value: string): boolean => UUID_RE.test(value);

export interface Grant {
    readonly clientId: string;
    readonly name: string | null;
    readonly website: string | null;
    readonly scopes: readonly string[];
    readonly grantedAt: string | null;
}

const asObject = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' ? (v as Record<string, unknown>) : {});
const asText = (v: unknown): string => (typeof v === 'string' ? v : '');

// Only an https address is ever shown or opened.
export function safeWebsite(value: string): string | null {
    try {
        const url = new URL(value);
        return url.protocol === 'https:' ? url.toString() : null;
    } catch {
        return null;
    }
}

// The answer is a list, or { grants: [...] }; a row with no client id cannot be revoked and is dropped.
export function normaliseGrants(raw: unknown): Grant[] {
    const rows = Array.isArray(raw) ? raw : Array.isArray(asObject(raw).grants) ? (asObject(raw).grants as unknown[]) : [];
    const out: Grant[] = [];
    for (const row of rows) {
        const g = asObject(row);
        const client = asObject(g.client);
        const clientId = asText(client.id) || asText(g.client_id);
        if (!validClientId(clientId)) continue;
        out.push({
            clientId,
            name: asText(client.name) || asText(g.client_name) || null,
            website: safeWebsite(asText(client.uri) || asText(g.client_uri)),
            scopes: Array.isArray(g.scopes) ? g.scopes.filter((s): s is string => typeof s === 'string') : [],
            grantedAt: asText(g.granted_at) || asText(g.created_at) || null,
        });
    }
    return out;
}

export type AccountErrorKey = 'acct.err.network' | 'acct.err.code' | 'acct.err.aal' | 'acct.err.rate' | 'acct.err.failed';

// A second factor on the account makes Supabase ask for it before a password change or a removal.
export function accountErrorKey(err: unknown): AccountErrorKey {
    if (err instanceof AuthError) {
        if (err.status === 0) return 'acct.err.network';
        if (err.code === 'insufficient_aal') return 'acct.err.aal';
        if (err.status === 429 || err.code === 'over_request_rate_limit' || err.code === 'over_email_send_rate_limit') return 'acct.err.rate';
        if (err.code === 'reauthentication_not_valid' || err.code === 'reauthentication_needed') return 'acct.err.code';
    }
    return 'acct.err.failed';
}

export function signInMethodKey(provider: string | null): 'acct.method.email' | 'acct.method.google' | 'acct.method.apple' | 'acct.method.other' {
    if (provider === 'email') return 'acct.method.email';
    if (provider === 'google') return 'acct.method.google';
    if (provider === 'apple') return 'acct.method.apple';
    return 'acct.method.other';
}
