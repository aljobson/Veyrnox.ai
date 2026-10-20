import { authedCall, type TokenSource } from './auth/accountCalls';
import { AuthError } from './auth/supabaseAuth';

// Passkeys already on the account (the web's Passkeys panel). Listing and removing need no native module, so this
// screen works today; adding one, or signing in with one, needs a native WebAuthn module and the spike S2 result
// (docs/mobile/PASSKEYS-SPIKE-S2.md) and is not built. Routes: GET /auth/v1/passkeys, DELETE /auth/v1/passkeys/:id.
export interface Passkey {
    readonly id: string;
    readonly name: string | null;
    readonly createdAt: string | null;
    readonly lastUsedAt: string | null;
}

const ID_RE = /^[A-Za-z0-9_-]{8,128}$/;
export const validPasskeyId = (value: unknown): value is string => typeof value === 'string' && ID_RE.test(value);

const rec = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const str = (v: unknown): string | null => (typeof v === 'string' && v ? v : null);

// The answer is a list, or { passkeys: [...] }; a row without a usable id cannot be removed and is dropped.
export function parsePasskeys(body: unknown): Passkey[] {
    const rows = Array.isArray(body) ? body : Array.isArray(rec(body).passkeys) ? (rec(body).passkeys as unknown[]) : [];
    const out: Passkey[] = [];
    for (const raw of rows) {
        const r = rec(raw);
        if (!validPasskeyId(r.id)) continue;
        out.push({ id: r.id, name: str(r.friendly_name), createdAt: str(r.created_at), lastUsedAt: str(r.last_used_at) });
    }
    return out;
}

export async function fetchPasskeys(getToken: TokenSource): Promise<Passkey[]> {
    return parsePasskeys(await authedCall(getToken, '/auth/v1/passkeys', { method: 'GET' }));
}

export async function removePasskey(getToken: TokenSource, id: string): Promise<void> {
    if (!validPasskeyId(id)) throw new AuthError(400, 'invalid_id');
    await authedCall(getToken, `/auth/v1/passkeys/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

export type PasskeyErrorKey = 'pk.err.network' | 'pk.err.off' | 'pk.err.aal' | 'pk.err.failed';

export function passkeyErrorKey(err: unknown): PasskeyErrorKey {
    if (err instanceof AuthError) {
        if (err.status === 0) return 'pk.err.network';
        if (err.status === 404) return 'pk.err.off';
        if (err.code === 'insufficient_aal') return 'pk.err.aal';
    }
    return 'pk.err.failed';
}
