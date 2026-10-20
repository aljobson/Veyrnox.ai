import { AuthError } from './auth/supabaseAuth';
import { authedCall, type TokenSource } from './auth/accountCalls';

// Approve or decline an assistant's request to connect (the web's /oauth/consent). Supabase Auth keeps the request;
// the person sees who is asking and what it may do, then decides. The answer carries the address to send the person
// back to, which is the assistant's own.
const ID_RE = /^[A-Za-z0-9_-]{8,128}$/;
export const validAuthorizationId = (value: unknown): value is string => typeof value === 'string' && ID_RE.test(value);

export interface Request {
    readonly name: string | null;
    readonly website: string | null;
    readonly redirect: string | null;
    readonly scopes: readonly string[];
    // The request names a publish scope: the Publish wording of the summary applies.
    readonly publish: boolean;
}

const rec = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const text = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

export function safeHttps(value: string): string | null {
    try {
        const u = new URL(value);
        return u.protocol === 'https:' ? u.toString() : null;
    } catch {
        return null;
    }
}

// Same fallbacks as the web page: the client may be under client or client_metadata, scopes a list or a string.
export function parseRequest(body: unknown): Request {
    const d = rec(body);
    const client = rec(d.client ?? d.client_metadata);
    const raw = d.scope ?? d.scopes ?? d.requested_scopes ?? [];
    const scopes = (Array.isArray(raw) ? raw : String(raw || '').split(/\s+/)).filter((s): s is string => typeof s === 'string' && s.length > 0);
    return {
        name: text(client.client_name) || text(client.name) || text(d.client_name) || null,
        website: safeHttps(text(client.client_uri) || text(client.uri) || text(d.client_uri)),
        redirect: text(d.redirect_uri) || null,
        scopes,
        publish: scopes.some((s) => /publish/i.test(s)),
    };
}

// Where to send the person after the decision. Only a web address or the assistant's own app scheme is opened:
// never a script, data, file or local-network address.
const BLOCKED = new Set(['javascript:', 'data:', 'file:', 'blob:', 'about:', 'vbscript:', 'content:', 'intent:']);
export function safeRedirect(value: unknown): string | null {
    if (typeof value !== 'string' || value.length > 2048) return null;
    try {
        const u = new URL(value);
        if (BLOCKED.has(u.protocol)) return null;
        if (u.protocol === 'https:') return u.toString();
        if (u.protocol === 'http:') return ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname) ? u.toString() : null;
        return /^[a-z][a-z0-9+.-]*:$/.test(u.protocol) ? u.toString() : null;
    } catch {
        return null;
    }
}

const enc = encodeURIComponent;

export async function fetchRequest(getToken: TokenSource, id: string): Promise<Request> {
    if (!validAuthorizationId(id)) throw new AuthError(400, 'invalid_request');
    return parseRequest(await authedCall(getToken, `/auth/v1/oauth/authorizations/${enc(id)}`, { method: 'GET' }));
}

export async function decide(getToken: TokenSource, id: string, action: 'approve' | 'deny'): Promise<string> {
    if (!validAuthorizationId(id)) throw new AuthError(400, 'invalid_request');
    const out = rec(await authedCall(getToken, `/auth/v1/oauth/authorizations/${enc(id)}/consent`, { method: 'POST', body: JSON.stringify({ action }) }));
    const target = safeRedirect(out.redirect_url ?? out.redirect_uri);
    if (!target) throw new AuthError(502, 'no_redirect');
    return target;
}

export type ConsentErrorKey = 'oac.err.gone' | 'oac.err.network' | 'oac.err.redirect' | 'oauth.saveError';

export function consentErrorKey(err: unknown): ConsentErrorKey {
    if (err instanceof AuthError) {
        if (err.status === 0) return 'oac.err.network';
        if (err.code === 'no_redirect') return 'oac.err.redirect';
        if (err.status === 400 || err.status === 404 || err.status === 410) return 'oac.err.gone';
    }
    return 'oauth.saveError';
}
