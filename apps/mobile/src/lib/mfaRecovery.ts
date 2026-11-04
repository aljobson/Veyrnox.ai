import { ApiError, type ApiClient } from './api';

// Two-factor recovery codes (web ADR-0311). A code removes the lost authenticator; it never mints an aal2 token.
// Codes live in memory only: never log, store or send them anywhere but the three calls below.
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
export const RECOVERY_CODE_LENGTH = 10;

// The server's own normalisation: case-folded, separators dropped, I and L read as 1, O as 0, no U.
export function normalizeRecoveryCode(input: string): string | null {
    const code = input.toUpperCase().replace(/[^0-9A-Z]/g, '').replace(/[IL]/g, '1').replace(/O/g, '0');
    return code.length === RECOVERY_CODE_LENGTH && [...code].every((c) => ALPHABET.includes(c)) ? code : null;
}
export const validRecoveryCode = (input: string): boolean => normalizeRecoveryCode(input) !== null;

// Shown as XXXXX-XXXXX while typing: dashes added for the person, anything else typed is kept for validation.
export function formatRecoveryInput(input: string): string {
    const cleaned = input.toUpperCase().replace(/[^0-9A-Z]/g, '').slice(0, RECOVERY_CODE_LENGTH);
    return cleaned.length > 5 ? `${cleaned.slice(0, 5)}-${cleaned.slice(5)}` : cleaned;
}

export interface RecoveryStatus {
    readonly usable: number;
    readonly needsRegeneration: boolean;
}

const RECOVER_ERRORS = ['recovery_stale', 'invalid_recovery_code', 'recovery_incomplete', 'recovery_rate_limited', 'recovery_not_configured', 'unauthorized'] as const;
const CODES_ERRORS = ['reauth_required', 'recovery_not_configured', 'unauthorized'] as const;

export type RecoverErrorKey = `authGate.mfa.recovery.error.${(typeof RECOVER_ERRORS)[number]}` | 'authGate.mfa.recovery.failed';
export type CodesErrorKey = `app.account.mfa.recovery.error.${(typeof CODES_ERRORS)[number]}` | 'app.account.mfa.recovery.failed';

const codeOf = (err: unknown): string => (err instanceof ApiError ? err.code : err instanceof Error ? err.message : '');

export function recoverErrorKey(err: unknown): RecoverErrorKey {
    const code = codeOf(err);
    return (RECOVER_ERRORS as readonly string[]).includes(code) ? (`authGate.mfa.recovery.error.${code}` as RecoverErrorKey) : 'authGate.mfa.recovery.failed';
}

export function codesErrorKey(err: unknown): CodesErrorKey {
    const code = codeOf(err);
    return (CODES_ERRORS as readonly string[]).includes(code) ? (`app.account.mfa.recovery.error.${code}` as CodesErrorKey) : 'app.account.mfa.recovery.failed';
}

export async function fetchRecoveryStatus(api: ApiClient): Promise<RecoveryStatus> {
    const body = await api.request<{ usable?: unknown; needs_regeneration?: unknown }>('/api/v1/mfa/recovery/codes');
    return { usable: typeof body?.usable === 'number' ? body.usable : 0, needsRegeneration: body?.needs_regeneration === true };
}

// Needs an aal2 session whose second factor was proved in the last five minutes: the caller verifies a fresh
// authenticator code first, otherwise the server answers 403 reauth_required.
export async function generateRecoveryCodes(api: ApiClient): Promise<string[]> {
    const body = await api.request<{ codes?: unknown }>('/api/v1/mfa/recovery/codes', { method: 'POST' });
    const codes = Array.isArray(body?.codes) ? body.codes.filter((c): c is string => typeof c === 'string') : [];
    if (codes.length === 0) throw new ApiError(502, 'malformed_codes');
    return codes;
}

// Works at aal1. 'stale' means the code belonged to an older authenticator: it is used up and the prompt stays.
export async function consumeRecoveryCode(api: ApiClient, input: string): Promise<'recovered' | 'stale'> {
    const code = normalizeRecoveryCode(input);
    if (!code) throw new ApiError(400, 'invalid_recovery_code');
    const body = await api.request<{ recovered?: unknown; stale?: unknown }>('/api/v1/mfa/recovery', { method: 'POST', body: JSON.stringify({ code }), headers: { 'Content-Type': 'application/json' } });
    if (body?.stale === true) return 'stale';
    if (body?.recovered === true) return 'recovered';
    throw new ApiError(502, 'recovery_incomplete');
}
