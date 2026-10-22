import { config } from '../config';
import { createRateGuard, reportIssue } from '../requestGuard';
import { AuthError, type TokenResponse } from './supabaseAuth';

// Account calls that go straight to Supabase Auth with the user's own access token, as the web does
// (app/lib/accountSecurity.js, app/lib/authClient.js). Nothing here touches sign-in itself.
export type TokenSource = (forceRefresh?: boolean) => Promise<string | null>;

export interface Profile {
    readonly email: string | null;
    readonly provider: string | null;
    readonly factors: readonly Factor[];
}

export interface Factor {
    readonly id: string;
    readonly status: string;
    readonly friendlyName: string;
}

export type SessionScope = 'others' | 'global';

async function send(token: string, path: string, init: RequestInit): Promise<Response> {
    try {
        return await fetch(`${config.supabaseUrl}${path}`, {
            ...init,
            headers: {
                'Content-Type': 'application/json',
                apikey: config.publishableKey,
                ...(init.headers as Record<string, string> | undefined),
                Authorization: `Bearer ${token}`,
            },
        });
    } catch {
        throw new AuthError(0, 'network');
    }
}

// Sends with the current token; after a 401 refreshes once and retries (like the API client).
export async function authedCall<T>(getToken: TokenSource, path: string, init: RequestInit = {}): Promise<T> {
    const token = await getToken();
    if (!token) throw new AuthError(401, 'not_authenticated');
    let res = await send(token, path, init);
    if (res.status === 401) {
        const retry = await getToken(true);
        if (retry && retry !== token) res = await send(retry, path, init);
    }
    const text = await res.text();
    let body: Record<string, unknown> = {};
    try {
        body = text ? (JSON.parse(text) as Record<string, unknown>) : {};
    } catch {
        body = {};
    }
    if (!res.ok) {
        const code = typeof body.error_code === 'string' ? body.error_code : typeof body.error === 'string' ? body.error : 'rejected';
        throw new AuthError(res.status, code);
    }
    return body as T;
}

interface RawUser {
    email?: unknown;
    app_metadata?: { provider?: unknown };
    factors?: unknown;
}

function toFactors(raw: unknown): Factor[] {
    if (!Array.isArray(raw)) return [];
    return raw
        .filter((f): f is Record<string, unknown> => Boolean(f) && typeof f === 'object')
        .filter((f) => f.factor_type === 'totp' && typeof f.id === 'string')
        .map((f) => ({
            id: f.id as string,
            status: typeof f.status === 'string' ? f.status : 'unverified',
            friendlyName: typeof f.friendly_name === 'string' && f.friendly_name ? f.friendly_name : 'Authenticator',
        }));
}

// At most this many profile reads in the window. Real use is a handful at launch; more means something is looping.
export const PROFILE_LIMIT = 6;
export const PROFILE_WINDOW_MS = 10_000;
let profileGuard = createRateGuard(PROFILE_LIMIT, PROFILE_WINDOW_MS);
let profileStormReported = false;

// For tests.
export function resetProfileGuard(): void {
    profileGuard = createRateGuard(PROFILE_LIMIT, PROFILE_WINDOW_MS);
    profileStormReported = false;
}

// `caller` names the screen asking, so a storm says where it came from.
export async function fetchProfile(getToken: TokenSource, caller = 'unknown'): Promise<Profile> {
    if (!profileGuard.allow()) {
        if (!profileStormReported) {
            profileStormReported = true;
            reportIssue('profile_request_storm', { caller });
        }
        throw new AuthError(429, 'too_many_requests');
    }
    const user = await authedCall<RawUser>(getToken, '/auth/v1/user', { method: 'GET' });
    return {
        email: typeof user.email === 'string' && user.email ? user.email : null,
        provider: typeof user.app_metadata?.provider === 'string' ? user.app_metadata.provider : null,
        factors: toFactors(user.factors),
    };
}

// Emails a one-time code that must go with the next password change.
export async function requestPasswordCode(getToken: TokenSource): Promise<void> {
    await authedCall(getToken, '/auth/v1/reauthenticate', { method: 'GET' });
}

export async function changePassword(getToken: TokenSource, password: string, nonce: string): Promise<void> {
    await authedCall(getToken, '/auth/v1/user', { method: 'PUT', body: JSON.stringify({ password, nonce }) });
}

// 'others' ends every session but this one; 'global' ends all of them, this one too.
export async function revokeSessions(getToken: TokenSource, scope: SessionScope): Promise<void> {
    await authedCall(getToken, `/auth/v1/logout?scope=${scope}`, { method: 'POST' });
}

export async function fetchGrantsRaw(getToken: TokenSource): Promise<unknown> {
    return authedCall(getToken, '/auth/v1/user/oauth/grants', { method: 'GET' });
}

export async function revokeGrant(getToken: TokenSource, clientId: string): Promise<void> {
    await authedCall(getToken, `/auth/v1/user/oauth/grants?client_id=${encodeURIComponent(clientId)}`, { method: 'DELETE' });
}

// ── Two-factor (TOTP), as app/lib/authClient.js and MfaPanel.js do ───────────────────────────────────
export interface Enrolment {
    readonly factorId: string;
    readonly secret: string;
    readonly uri: string;
}

// Creates an unverified factor; it does nothing until verifyFactor succeeds with a code from the authenticator app.
export async function enrollTotp(getToken: TokenSource, friendlyName: string): Promise<Enrolment> {
    const data = await authedCall<{ id?: unknown; totp?: { secret?: unknown; uri?: unknown } }>(getToken, '/auth/v1/factors', {
        method: 'POST',
        body: JSON.stringify({ factor_type: 'totp', friendly_name: friendlyName }),
    });
    if (typeof data.id !== 'string' || !data.id) throw new AuthError(502, 'malformed_enrolment');
    return {
        factorId: data.id,
        secret: typeof data.totp?.secret === 'string' ? data.totp.secret : '',
        uri: typeof data.totp?.uri === 'string' ? data.totp.uri : '',
    };
}

// Challenge then verify. Finishes enrolment, or steps an aal1 session up to aal2. Supabase answers with a new
// token pair, which the caller must adopt: the old token stays aal1.
export async function verifyFactor(getToken: TokenSource, factorId: string, code: string): Promise<TokenResponse> {
    const id = encodeURIComponent(factorId);
    const challenge = await authedCall<{ id?: unknown }>(getToken, `/auth/v1/factors/${id}/challenge`, { method: 'POST' });
    if (typeof challenge.id !== 'string' || !challenge.id) throw new AuthError(502, 'malformed_challenge');
    return authedCall<TokenResponse>(getToken, `/auth/v1/factors/${id}/verify`, {
        method: 'POST',
        body: JSON.stringify({ challenge_id: challenge.id, code }),
    });
}

// Needs an aal2 session; Supabase enforces that.
export async function unenrollFactor(getToken: TokenSource, factorId: string): Promise<void> {
    await authedCall(getToken, `/auth/v1/factors/${encodeURIComponent(factorId)}`, { method: 'DELETE' });
}
