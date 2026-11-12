import type { ApiClient } from './api';
import { readRemoteFirstGoal, type RemoteFirstGoal, type StoredFirstGoal } from './firstGoal';

// The first-goal answer on the server (ADR-0336, routes /api/v1/first-goal). The server answers 404 while its own
// FIRST_GOAL_SYNC_ENABLED is off, and a failed or slow request means "unavailable": the card then falls back to this
// phone's own copy. Nothing here ever blocks the screen or throws.
export async function fetchRemoteFirstGoal(api: Pick<ApiClient, 'request'>): Promise<RemoteFirstGoal> {
    try {
        return readRemoteFirstGoal(await api.request<unknown>('/api/v1/first-goal'));
    } catch {
        return { kind: 'unavailable' };
    }
}

// Best effort and safe to repeat: the server never lowers an answer and treats the same word again as a replay.
export async function pushFirstGoal(api: Pick<ApiClient, 'request'>, goal: StoredFirstGoal): Promise<void> {
    try {
        await api.request('/api/v1/first-goal', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ goal }) });
    } catch { /* the phone's copy still holds the answer */ }
}
