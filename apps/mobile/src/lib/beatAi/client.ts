import { ApiError, type ApiClient } from '../api';
import { isRecord } from '../responseShapes';
import { aiPaths, aiPollPath, assetSigningPath } from './shared';
import type { Asset, Candidate, Op, Quote, QuoteSnapshot, Song, Status } from './types';
import { secureRemoteSongUrl } from '../beatNative/remoteSong';
export const uuid = (v: unknown): v is string => typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
const integer = (v: unknown) => typeof v === 'number' && Number.isSafeInteger(v);
export const validQuote = (v: unknown): v is QuoteSnapshot => isRecord(v) && integer(v.total_credits) && (v.total_credits as number) >= 0 && integer(v.balance) && integer(v.balance_after) && typeof v.affordable === 'boolean' && typeof v.expires_at === 'string' && /^\d{4}-\d\d-\d\dT/.test(v.expires_at) && Number.isFinite(Date.parse(v.expires_at));
export const validCandidate = (v: unknown): v is Candidate => isRecord(v) && [1, 2].includes(v.ordinal as number) && typeof v.state === 'string' && ['song_id', 'version_id', 'job_id'].every(k => v[k] == null || uuid(v[k])) && (v.title == null || typeof v.title === 'string');
export const validStatus = (v: unknown): v is Status => isRecord(v) && typeof v.state === 'string' && (v.candidates === undefined || Array.isArray(v.candidates) && v.candidates.length <= 2 && v.candidates.every(validCandidate) && new Set(v.candidates.map(c => c.ordinal)).size === v.candidates.length);
export function createBeatAiClient(api: ApiClient, owner: string, signal?: AbortSignal) {
    async function call<T>(path: string, guard: (value: unknown) => value is T, body?: object): Promise<T> {
        const result = await api.request<unknown>(`/api/v1${path}`, { signal, ...(body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}) }, { owner });
        if (!guard(result)) throw new ApiError(200, 'bad_response');
        return result;
    }
    return {
        quote: (op: Op, songId: string | undefined, body: object) => call(aiPaths(op, songId).quote, (v): v is Quote => isRecord(v) && uuid(v.quote_id) && validQuote(v), body),
        submit: (r: { submitPath: string; quoteId: string; key: string }) => call(r.submitPath, (v): v is { generation_id?: string; request_id?: string; state: string } => isRecord(v) && (uuid(v.generation_id) || uuid(v.request_id)) && typeof v.state === 'string', { quote_id: r.quoteId, idempotency_key: r.key }),
        poll: (r: { op: Op; requestId?: string }) => { if (!uuid(r.requestId)) throw new ApiError(0, 'invalid_request'); return call(aiPollPath(r), validStatus); },
        song: (id: string) => call(`/music/songs/${encodeURIComponent(id)}`, (v): v is Song => isRecord(v) && uuid(v.version_id) && isRecord(v.current_version) && uuid(v.current_version.id) && Array.isArray(v.actions) && v.actions.every(a => typeof a === 'string')),
        sign: (item: Pick<Asset, 'source' | 'ref'>) => { const path = assetSigningPath(item); if (!path) throw new ApiError(0, 'invalid_asset'); return call(path, (v): v is { url: string; size_bytes?: number } => {
            if (!isRecord(v) || typeof v.url !== 'string' || !(v.size_bytes === undefined || integer(v.size_bytes) && (v.size_bytes as number) > 0)) return false;
            try { secureRemoteSongUrl(v.url); return true; } catch { return false; }
        }); },
    };
}
export type BeatAiClient = ReturnType<typeof createBeatAiClient>;
