// Session handoff shared by the production hosted editor and the device spike.
// Only the short-lived access token enters the WebView; the refresh token remains in native secure storage.

const WEB_SESSION_KEY = 'veyrnox_supabase_session';
const WEB_SIGNED_OUT_KEY = 'veyrnox_session_signed_out';

export interface SessionSeed {
    readonly access_token: string;
    readonly refresh_token: null;
    readonly token_type: 'bearer';
    readonly expires_at: number;
    readonly user: { readonly id: string; readonly email?: string };
}

function decodeBase64Url(part: string): string | null {
    try {
        const padded = part.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(part.length / 4) * 4, '=');
        const binary = atob(padded);
        return decodeURIComponent(Array.from(binary, (c) => `%${c.charCodeAt(0).toString(16).padStart(2, '0')}`).join(''));
    } catch {
        return null;
    }
}

export function jwtClaims(token: string): { sub?: string; email?: string; exp?: number } | null {
    const part = token.split('.')[1];
    if (!part) return null;
    const json = decodeBase64Url(part);
    if (!json) return null;
    try {
        const claims = JSON.parse(json) as unknown;
        if (!claims || typeof claims !== 'object') return null;
        const record = claims as Record<string, unknown>;
        return {
            sub: typeof record.sub === 'string' ? record.sub : undefined,
            email: typeof record.email === 'string' ? record.email : undefined,
            exp: typeof record.exp === 'number' && Number.isFinite(record.exp) ? record.exp : undefined,
        };
    } catch {
        return null;
    }
}

export function buildSessionSeed(accessToken: string): SessionSeed | null {
    const claims = jwtClaims(accessToken);
    if (!claims?.sub || claims.exp === undefined) return null;
    return {
        access_token: accessToken,
        refresh_token: null,
        token_type: 'bearer',
        expires_at: Math.floor(claims.exp),
        user: claims.email ? { id: claims.sub, email: claims.email } : { id: claims.sub },
    };
}

export function seedSecondsLeft(seed: SessionSeed, nowMs: number): number {
    return Math.floor(seed.expires_at - nowMs / 1000);
}

function jsLiteral(value: unknown): string {
    return JSON.stringify(value)
        .replace(/</g, '\\u003c')
        .replace(/\u2028/g, '\\u2028')
        .replace(/\u2029/g, '\\u2029');
}

// Runs before the page bundle, in the main frame only, and refuses to write on a foreign origin.
export function sessionInjection(seed: SessionSeed, origin: string): string {
    return `(function(){try{
if(location.origin!==${jsLiteral(origin)})return;
localStorage.removeItem(${jsLiteral(WEB_SIGNED_OUT_KEY)});
localStorage.setItem(${jsLiteral(WEB_SESSION_KEY)},JSON.stringify(${jsLiteral(seed)}));
}catch(e){}})();true;`;
}
