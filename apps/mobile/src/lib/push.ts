import { ApiError, type ApiClient } from './api';

// Push notifications for finished creations (server ADR-0113, app ADR-0110 decision 7).
// The server answers 404 while its own PUSH_NOTIFICATIONS_ENABLED is off.

// Build-time switch, off unless "true", like store billing. Registration also needs the
// EAS project id in app.json, so a build without one never asks for a token.
export const PUSH_ENABLED = process.env.EXPO_PUBLIC_PUSH_ENABLED === 'true';

// The Android channel id the server sends to.
export const JOBS_CHANNEL = 'jobs';

const TOKEN_RE = /^Expo(nent)?PushToken\[[^\]\s]{1,200}\]$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const isPushToken = (value: unknown): value is string => typeof value === 'string' && TOKEN_RE.test(value);

export interface DeviceInput {
    readonly token: string;
    readonly platform: 'ios' | 'android';
    // Stable per install; a new token with the same id replaces the old one.
    readonly deviceId: string;
    readonly appVersion: string;
    readonly notifyJobs: boolean;
}

export type Registered =
    | { readonly kind: 'registered'; readonly notifyJobs: boolean }
    // The server flag is off: skip silently.
    | { readonly kind: 'unavailable' }
    | { readonly kind: 'rate_limited' }
    | { readonly kind: 'failed' };

// Safe to call on every launch and sign-in: the server treats a repeat as a replay.
export async function registerDevice(api: Pick<ApiClient, 'request'>, input: DeviceInput): Promise<Registered> {
    if (!isPushToken(input.token)) return { kind: 'failed' };
    try {
        const out = await api.request<{ notify_jobs?: boolean }>('/api/v1/devices', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                token: input.token,
                platform: input.platform,
                device_id: input.deviceId,
                app_version: input.appVersion,
                notify_jobs: input.notifyJobs,
            }),
        });
        return { kind: 'registered', notifyJobs: out.notify_jobs !== false };
    } catch (err) {
        if (err instanceof ApiError) {
            if (err.status === 404) return { kind: 'unavailable' };
            if (err.status === 429) return { kind: 'rate_limited' };
        }
        return { kind: 'failed' };
    }
}

// Call before the session is revoked. True when the server no longer holds the token
// (it also answers 200 when the token was already gone).
export async function removeDevice(api: Pick<ApiClient, 'request'>, token: string): Promise<boolean> {
    if (!isPushToken(token)) return false;
    try {
        await api.request('/api/v1/devices', {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ token }),
        });
        return true;
    } catch {
        return false;
    }
}

// The server sends { type: 'job', job_id, state } and nothing else of use. Returns the job
// screen for a well-formed id, otherwise null so a malformed push opens nothing.
export function jobRouteFromPush(data: unknown): string | null {
    if (!data || typeof data !== 'object') return null;
    const { type, job_id: jobId } = data as Record<string, unknown>;
    if (type !== 'job' || typeof jobId !== 'string' || !UUID_RE.test(jobId)) return null;
    return `/job/${jobId}`;
}
