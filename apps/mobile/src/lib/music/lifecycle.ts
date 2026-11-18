import { ApiError, type ApiClient } from '../api';
import { listSongs, setSongLifecycle } from './client';
import { probeMusic } from './probe';
export type LifecycleState = { revision: number; lifecycle_status: string };
export function routeRevision(value: unknown): LifecycleState | null {
    if (typeof value !== 'string' || !value.trim() || !Number.isFinite(Number(value))) return null;
    return { revision: Number(value), lifecycle_status: 'active' };
}
export async function findLifecycle(api: ApiClient, id: string): Promise<LifecycleState | null> {
    const active = await listSongs(api, { limit: 50 });
    const row = active.find(s => s.id === id) ?? (await listSongs(api, { limit: 50, collection: 'trash' })).find(s => s.id === id);
    return row && typeof row.revision === 'number' ? { revision: row.revision, lifecycle_status: row.lifecycle_status ?? 'active' } : null;
}
export async function changeLifecycle(api: ApiClient, id: string, state: LifecycleState, action: 'trash' | 'restore') {
    const result = await probeMusic(() => setSongLifecycle(api, id, action, state.revision));
    if (result.state === 'on') return { state: 'saved' as const, value: result.data.song };
    if (result.state === 'error' && result.code === 'revision_conflict') {
        const refreshed = await probeMusic(() => findLifecycle(api, id));
        return { state: 'conflict' as const, value: refreshed.state === 'on' ? refreshed.data : null };
    }
    if (result.state === 'off') return { state: 'off' as const };
    throw new ApiError(result.status, result.code);
}
