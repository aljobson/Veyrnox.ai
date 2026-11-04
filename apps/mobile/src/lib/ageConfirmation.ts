import { ApiError, type ApiClient } from './api';
import { MIN_AGE } from './account';

// Recorded minimum-age confirmation (web ADR-0317). The server switch AGE_CONFIRMATION_ENABLED decides whether the
// question is asked at all: GET /api/v1/account says so through age_confirmation_required. This is a self-declaration,
// not age verification, and declining is local only: nothing is sent or stored when someone says they are under age.
export const AGE_CONFIRMATION_VERSION = 'age-18-v1';
export { MIN_AGE };

export type AgeCheck = 'ask' | 'confirmed' | 'unknown';

// Fail open: only an explicit true asks. A missing field, a failed read or a different shape never blocks the app.
export function ageCheckFrom(account: unknown): AgeCheck {
    if (typeof account !== 'object' || account === null) return 'unknown';
    const a = account as { age_confirmation_required?: unknown; age_confirmed?: unknown };
    if (a.age_confirmation_required === true) return 'ask';
    if (a.age_confirmation_required === false || a.age_confirmed === true) return 'confirmed';
    return 'unknown';
}

export async function readAgeCheck(api: ApiClient): Promise<AgeCheck> {
    try {
        return ageCheckFrom(await api.request<unknown>('/api/v1/account'));
    } catch {
        return 'unknown';
    }
}

// Throws when the server did not record it. 'account_not_found' means the account row is not ready yet: read again.
export async function confirmAge(api: ApiClient): Promise<void> {
    const body = await api.request<{ age_confirmed?: unknown }>('/api/v1/account/age-confirmation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirm: true, version: AGE_CONFIRMATION_VERSION }),
    });
    if (body?.age_confirmed !== true) throw new ApiError(502, 'confirmation_unavailable');
}

export const isAccountNotReady = (err: unknown): boolean => err instanceof ApiError && err.code === 'account_not_found';

// Waits between reads of an unknown answer: 1 s, 2 s, 4 s, then lets the person through.
export const AGE_READ_RETRY_MS = [1000, 2000, 4000] as const;
