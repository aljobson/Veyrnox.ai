import { Platform } from 'react-native';
import { config } from './config';
import { createCredential, nativePasskeysSupported, PasskeyCeremonyError, classifyNativeError, type CreationOptions, type RequestOptions } from './auth/passkeyNative';
import { authedCall, type TokenSource } from './auth/accountCalls';
import { AuthError } from './auth/supabaseAuth';

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

// Expo replaces these direct environment reads at build time. Neither platform ships enabled.
export function passkeyGate(): boolean {
    const enabled = Platform.OS === 'ios'
        ? process.env.EXPO_PUBLIC_PASSKEYS_IOS_ENABLED === 'true'
        : Platform.OS === 'android' && process.env.EXPO_PUBLIC_PASSKEYS_ANDROID_ENABLED === 'true';
    return enabled && nativePasskeysSupported();
}

export function validatePasskeyOptions(body: unknown, creation: true): { challengeId: string; options: CreationOptions };
export function validatePasskeyOptions(body: unknown, creation: false): { challengeId: string; options: RequestOptions };
export function validatePasskeyOptions(body: unknown, creation: boolean) {
    const data = rec(body);
    const options = rec(data.options);
    if (typeof data.challenge_id !== 'string' || !data.challenge_id.trim() || typeof options.challenge !== 'string'
        || (creation && (typeof rec(options.rp).id !== 'string' || typeof rec(options.user).id !== 'string'))) {
        throw new AuthError(502, 'malformed_options');
    }
    return { challengeId: data.challenge_id, options: options as unknown as CreationOptions };
}

// Binary WebAuthn fields are already base64url strings. Match the web encoder's field whitelist.
export function toGoTrueCredential(json: unknown) {
    const value = rec(json);
    const rawResponse = rec(value.response);
    if (!str(value.id) || !str(value.rawId) || !str(rawResponse.clientDataJSON)) throw new AuthError(502, 'malformed_credential');
    const response: Record<string, string> = { clientDataJSON: rawResponse.clientDataJSON as string };
    for (const key of ['attestationObject', 'authenticatorData', 'signature', 'userHandle']) {
        if (typeof rawResponse[key] === 'string') response[key] = rawResponse[key];
    }
    return {
        id: value.id as string,
        rawId: value.rawId as string,
        type: typeof value.type === 'string' ? value.type : 'public-key',
        clientExtensionResults: rec(value.clientExtensionResults),
        response,
        ...(typeof value.authenticatorAttachment === 'string' ? { authenticatorAttachment: value.authenticatorAttachment } : {}),
    };
}

export async function addPasskey(getToken: TokenSource, name: string): Promise<unknown | null> {
    if (!passkeyGate()) return null;
    const friendlyName = name.trim().slice(0, 64);
    const body = await authedCall(getToken, '/auth/v1/passkeys/registration/options', {
        method: 'POST', body: JSON.stringify(friendlyName ? { friendly_name: friendlyName } : {}),
    });
    const { challengeId, options } = validatePasskeyOptions(body, true);
    const credential = await createCredential(options);
    if (credential === null) return null;
    return authedCall(getToken, '/auth/v1/passkeys/registration/verify', {
        method: 'POST', body: JSON.stringify({ challenge_id: challengeId, credential: toGoTrueCredential(credential) }),
    });
}

// A failed settings read must not prevent an attempt (ADR-0032 amendment).
export async function passkeysServerAvailable(): Promise<boolean> {
    try {
        const res = await fetch(`${config.supabaseUrl}/auth/v1/settings`, { headers: { apikey: config.publishableKey } });
        if (!res.ok) return true;
        return rec(await res.json()).passkeys_enabled !== false;
    } catch { return true; }
}

export function passkeySignInErrorKey(err: unknown) {
    if (err instanceof AuthError) {
        if (err.status === 0) return 'passkey.err.network';
        if (err.code === 'captcha_failed') return 'passkey.err.captcha';
        if (err.code === 'passkey_disabled' || err.status === 404) return 'passkey.err.off';
        if (err.code === 'webauthn_credential_not_found') return 'passkey.err.noCredential';
        if (err.code === 'webauthn_challenge_expired') return 'passkey.err.expired';
        if (err.status === 429) return 'passkey.err.busy';
        if (err.status >= 400 && err.status < 500) return 'passkey.err.refused';
    }
    if (err instanceof PasskeyCeremonyError) {
        switch (err.kind) {
            case 'unsupported': return 'passkey.err.unsupported';
            case 'no_credential': return 'passkey.err.noCredential';
            case 'setup': return 'passkey.err.setup';
            case 'busy': return 'passkey.err.busy';
        }
    } else if (!(err instanceof AuthError) && classifyNativeError(err) === 'cancelled') return null;
    return 'passkey.err.failed';
}

export function passkeyAddErrorKey(err: unknown) {
    if (err instanceof PasskeyCeremonyError) return passkeySignInErrorKey(err);
    if (err instanceof AuthError && err.code.includes('exists')) return 'passkey.duplicate';
    if (err instanceof AuthError && err.code === 'passkey_disabled') return 'pk.err.off';
    return passkeyErrorKey(err);
}
