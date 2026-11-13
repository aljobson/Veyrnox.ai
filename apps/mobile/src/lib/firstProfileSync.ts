import type { ApiClient } from './api';
import { readRemoteFirstGoal } from './firstGoal';
import { readRemoteFirstProfile, type StoredDestination, type StoredRole } from './firstProfile';

// The first-run answers on the server (ADR-0339, routes /api/v1/first-goal). The server answers 404 while its own
// FIRST_GOAL_SYNC_ENABLED is off, and a failed or slow request means "unavailable": the phone's own copy then decides.
// Nothing here ever blocks a screen or throws.
export type RemoteAnswers =
    | { readonly kind: 'answers'; readonly goal: string | null; readonly role: StoredRole | null; readonly destination: StoredDestination | null }
    | { readonly kind: 'unavailable' };

export async function fetchRemoteFirstAnswers(api: Pick<ApiClient, 'request'>): Promise<RemoteAnswers> {
    try {
        const body = await api.request<unknown>('/api/v1/first-goal');
        const profile = readRemoteFirstProfile(body);
        const goal = readRemoteFirstGoal(body);
        if (profile.kind !== 'profile' || goal.kind === 'unavailable') return { kind: 'unavailable' };
        return { kind: 'answers', goal: goal.kind === 'goal' ? goal.goal : null, role: profile.role, destination: profile.destination };
    } catch {
        return { kind: 'unavailable' };
    }
}

// Best effort and safe to repeat: the server never lowers an answer and treats the same words again as a replay.
export async function pushFirstAnswers(api: Pick<ApiClient, 'request'>, answers: { readonly goal?: string; readonly role?: string; readonly destination?: string }): Promise<void> {
    const body: Record<string, string> = {};
    for (const key of ['goal', 'role', 'destination'] as const) if (typeof answers[key] === 'string') body[key] = answers[key] as string;
    if (Object.keys(body).length === 0) return;
    try {
        await api.request('/api/v1/first-goal', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    } catch { /* the phone's copy still holds the answers */ }
}
