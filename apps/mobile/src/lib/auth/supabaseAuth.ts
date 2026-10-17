import { config } from '../config';

export interface Session {
    readonly accessToken: string;
    readonly refreshToken: string;
    // Epoch milliseconds.
    readonly expiresAt: number;
}

export class AuthError extends Error {
    constructor(readonly status: number, readonly code: string) {
        super(`auth_${code}`);
        this.name = 'AuthError';
    }
}

export type OAuthProvider = 'apple' | 'google';

interface TokenResponse {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    error_code?: string;
    error?: string;
}

function toSession(body: TokenResponse, now: number): Session {
    if (!body.access_token || !body.refresh_token || typeof body.expires_in !== 'number') {
        throw new AuthError(502, 'malformed_token_response');
    }
    return {
        accessToken: body.access_token,
        refreshToken: body.refresh_token,
        expiresAt: now + body.expires_in * 1000,
    };
}

async function tokenRequest(grantType: string, payload: Record<string, unknown>, now = Date.now()): Promise<Session> {
    let res: Response;
    try {
        res = await fetch(`${config.supabaseUrl}/auth/v1/token?grant_type=${encodeURIComponent(grantType)}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', apikey: config.publishableKey },
            body: JSON.stringify(payload),
        });
    } catch {
        throw new AuthError(0, 'network');
    }
    const body = (await res.json().catch(() => ({}))) as TokenResponse;
    if (!res.ok) throw new AuthError(res.status, body.error_code || body.error || 'rejected');
    return toSession(body, now);
}

export function authorizeUrl(provider: OAuthProvider, challenge: string, redirectTo: string): string {
    const params = new URLSearchParams({
        provider,
        redirect_to: redirectTo,
        code_challenge: challenge,
        code_challenge_method: 's256',
    });
    return `${config.supabaseUrl}/auth/v1/authorize?${params.toString()}`;
}

export function exchangeAuthCode(code: string, verifier: string): Promise<Session> {
    return tokenRequest('pkce', { auth_code: code, code_verifier: verifier });
}

export function signInWithIdToken(provider: OAuthProvider, idToken: string, nonce: string): Promise<Session> {
    return tokenRequest('id_token', { provider, id_token: idToken, nonce });
}

export function refreshSession(refreshToken: string): Promise<Session> {
    return tokenRequest('refresh_token', { refresh_token: refreshToken });
}

// Best effort: the local session is cleared whether or not this reaches the server.
export async function revokeSession(accessToken: string): Promise<void> {
    try {
        await fetch(`${config.supabaseUrl}/auth/v1/logout`, {
            method: 'POST',
            headers: { apikey: config.publishableKey, Authorization: `Bearer ${accessToken}` },
        });
    } catch {
        // Offline sign-out still clears the device.
    }
}
