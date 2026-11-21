import type { ApiClient } from '../api';
import { failure } from './errors';
export type BeatAiProbe = { state: 'on' | 'off' | 'offline' | 'error' | 'signed_out' };
export async function probeBeatAi(api: ApiClient, owner: string, signal?: AbortSignal): Promise<BeatAiProbe> {
    try {
        await api.request('/api/v1/music/generation-quotes', { method: 'POST', signal, headers: { 'Content-Type': 'application/json' }, body: '{"model_id":"ace-step-loop"}' }, { owner });
        return { state: 'error' };
    } catch (error) {
        const e = failure(error);
        if (e.status === 404 || e.code.endsWith('_unavailable')) return { state: 'off' };
        if (e.status === 400) return { state: 'on' };
        if (e.status === 401) return { state: 'signed_out' };
        return { state: e.status === 0 ? 'offline' : 'error' };
    }
}
