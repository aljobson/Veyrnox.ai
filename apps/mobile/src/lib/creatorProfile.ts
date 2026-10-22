import { ApiError, type ApiClient } from './api';
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

// The server's copy, if it has one: lets a second phone, or a reinstall, skip the interview.
export async function fetchVibe(api: Pick<ApiClient, 'request'>): Promise<StoredVibe | null> {
    try {
        const r = await api.request<{ status?: unknown; answers?: unknown }>('/api/v1/creator-profile');
        if (r.status === 'skipped') return { version: 1, state: 'skipped', answers: null, synced: true };
        if (r.status === 'completed' && isCreatorAnswers(r.answers)) return { version: 1, state: 'completed', answers: r.answers, synced: true };
        return null;
    } catch {
        return null;
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
