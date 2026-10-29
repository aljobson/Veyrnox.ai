import { ApiError, REQUEST_TIMEOUT_MS, type ApiClient } from './api';
import { isCreatorAnswers, type CreatorAnswers } from './creatorAnswers';

// The Vibe Check on the phone (server ADR-0251, routes /api/v1/creator-profile). The server answers 404 while its own
// CREATOR_PROFILE_ENABLED is off; this build-time switch keeps a build that does not ship the interview from offering it.
export const CREATOR_PROFILE_ENABLED = process.env.EXPO_PUBLIC_CREATOR_PROFILE_ENABLED === 'true';

// What this phone remembers: that the person chose (so the interview is offered once), and the answers, which only
// steer the order of templates and a default or two. `synced` is false until the server has the same thing.
export const VIBE_SLOT = 'veyrnox.vibe.v1';

export type VibeState = 'completed' | 'skipped';
export interface StoredVibe {
    readonly version: 1;
    readonly state: VibeState;
    readonly answers: CreatorAnswers | null;
    readonly synced: boolean;
}

export function serializeVibe(v: Omit<StoredVibe, 'version'>): string {
    return JSON.stringify({ version: 1, state: v.state, answers: v.state === 'completed' ? v.answers : null, synced: v.synced });
}

// Anything unreadable, from another version, or half-formed reads as "never chose", so the person is simply asked again.
export function parseVibe(raw: string | null | undefined): StoredVibe | null {
    if (!raw) return null;
    try {
        const v = JSON.parse(raw) as { version?: unknown; state?: unknown; answers?: unknown; synced?: unknown } | null;
        if (!v || Array.isArray(v) || v.version !== 1) return null;
        if (v.state === 'skipped') return { version: 1, state: 'skipped', answers: null, synced: v.synced === true };
        if (v.state === 'completed' && isCreatorAnswers(v.answers)) return { version: 1, state: 'completed', answers: v.answers, synced: v.synced === true };
        return null;
    } catch {
        return null;
    }
}

// Offered to someone who has not chosen yet, when the build ships it.
export const shouldOfferVibe = (stored: StoredVibe | null, enabled: boolean = CREATOR_PROFILE_ENABLED): boolean => enabled && stored === null;

export type VibeResult =
    | { readonly kind: 'ok' }
    // The server flag is off: keep the answers on the phone and say nothing.
    | { readonly kind: 'unavailable' }
    | { readonly kind: 'failed' };

const JSON_HEADERS = { 'Content-Type': 'application/json' };

function toResult(err: unknown): VibeResult {
    return err instanceof ApiError && err.status === 404 ? { kind: 'unavailable' } : { kind: 'failed' };
}

export const VIBE_REQUEST_DEADLINE_MS = REQUEST_TIMEOUT_MS + 5_000;

// Covers token refresh, consent, headers AND the response body. Late transport results are inert.
export function withVibeDeadline(api: Pick<ApiClient, 'request'>): Pick<ApiClient, 'request'> {
    return { async request<T>(path: string, init?: RequestInit, options?: Parameters<ApiClient['request']>[2]): Promise<T> {
        const controller = new AbortController();
        const signal = init?.signal ? AbortSignal.any([init.signal, controller.signal]) : controller.signal;
        let timer: ReturnType<typeof setTimeout> | undefined;
        const request = Promise.resolve().then(() => api.request<T>(path, { ...init, signal }, options));
        const deadline = new Promise<never>((_, reject) => {
            timer = setTimeout(() => {
                controller.abort();
                reject(new ApiError(0, 'network', { timedOut: true }));
            }, VIBE_REQUEST_DEADLINE_MS);
        });
        void request.catch(() => undefined);
        try { return await Promise.race([request, deadline]); }
        finally { clearTimeout(timer); }
    } };
}

export type VibeStatus = { kind: 'none' } | { kind: 'chosen'; vibe: StoredVibe } |
    { kind: 'unavailable' } | { kind: 'failed' };

export async function fetchVibeStatus(api: Pick<ApiClient, 'request'>): Promise<VibeStatus> {
    try {
        const r = await api.request<{ status?: unknown; answers?: unknown }>('/api/v1/creator-profile');
        if (r.status === 'none') return { kind: 'none' };
        if (r.status === 'skipped') return { kind: 'chosen', vibe: { version: 1, state: 'skipped', answers: null, synced: true } };
        if (r.status === 'completed' && isCreatorAnswers(r.answers)) return { kind: 'chosen', vibe: { version: 1, state: 'completed', answers: r.answers, synced: true } };
        return { kind: 'failed' };
    } catch (err) {
        return err instanceof ApiError && err.status === 404 ? { kind: 'unavailable' } : { kind: 'failed' };
    }
}

export async function fetchVibe(api: Pick<ApiClient, 'request'>): Promise<StoredVibe | null> {
    const r = await fetchVibeStatus(api);
    return r.kind === 'chosen' ? r.vibe : null;
}

export async function skipVibeStatus(api: Pick<ApiClient, 'request'>): Promise<
    { kind: 'skipped' | 'kept' | 'unavailable' | 'failed' }
> {
    try {
        const r = await api.request<{ status?: unknown }>('/api/v1/creator-profile/skip', { method: 'POST' });
        return { kind: r.status === 'skipped' ? 'skipped' : r.status === 'completed' ? 'kept' : 'failed' };
    } catch (err) {
        return { kind: err instanceof ApiError && err.status === 404 ? 'unavailable' : 'failed' };
    }
}

// Safe to repeat: the server treats the same answers again as a replay.
export async function saveVibe(api: Pick<ApiClient, 'request'>, answers: CreatorAnswers): Promise<VibeResult> {
    try {
        await api.request('/api/v1/creator-profile', { method: 'PUT', headers: JSON_HEADERS, body: JSON.stringify(answers) });
        return { kind: 'ok' };
    } catch (err) {
        return toResult(err);
    }
}

export async function skipVibe(api: Pick<ApiClient, 'request'>): Promise<VibeResult> {
    try {
        await api.request('/api/v1/creator-profile/skip', { method: 'POST' });
        return { kind: 'ok' };
    } catch (err) {
        return toResult(err);
    }
}

export async function resetVibe(api: Pick<ApiClient, 'request'>): Promise<VibeResult> {
    try {
        await api.request('/api/v1/creator-profile', { method: 'DELETE' });
        return { kind: 'ok' };
    } catch (err) {
        return toResult(err);
    }
}

// Pushes a stored choice the server has not seen yet. Returns the stored value, marked synced when it went through.
export async function syncVibe(api: Pick<ApiClient, 'request'>, stored: StoredVibe): Promise<StoredVibe> {
    if (stored.synced) return stored;
    const r = stored.state === 'completed' && stored.answers ? await saveVibe(api, stored.answers) : await skipVibe(api);
    return r.kind === 'ok' ? { ...stored, synced: true } : stored;
}
