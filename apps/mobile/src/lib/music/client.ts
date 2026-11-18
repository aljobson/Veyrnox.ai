import { ApiError, type ApiClient } from '../api';
import { isRecord, isFiniteNumber } from '../responseShapes';
import type {
    MusicCustomQuoteInput, MusicEntitlements, MusicGeneration, MusicLibraryTab, MusicLibraryTabData, MusicQuote,
    MusicRow, MusicSimpleQuoteInput, MusicSong, MusicSongsQuery,
} from './types';

// Typed client over /api/v1/music/*. Request and response shapes come from the route handlers
// (app/api/v1/music/**/route.js). Every function throws ApiError; wrap in probeMusic() to get an
// 'off' state instead of an exception when a feature is not switched on.
const BASE = '/api/v1/music';
const bad = (status = 200): ApiError => new ApiError(status, 'bad_response');
const rows = (value: unknown): readonly MusicRow[] | null => Array.isArray(value) && value.every(isRecord) ? value : null;
const post = (body: unknown): RequestInit => ({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

export async function getEntitlements(api: ApiClient): Promise<MusicEntitlements> {
    const v = await api.request<unknown>(`${BASE}/entitlements`);
    if (!isRecord(v) || typeof v.available !== 'boolean' || !Array.isArray(v.models) || !isFiniteNumber(v.balance)
        || !isRecord(v.custom_drafts) || !v.models.every((m) => isRecord(m) && typeof m.id === 'string' && isFiniteNumber(m.credits_per_candidate))) {
        throw bad();
    }
    return v as unknown as MusicEntitlements;
}

// GET ?tab=history|hooks|covers. The key in the answer depends on the tab.
export async function getLibraryTab(api: ApiClient, tab: MusicLibraryTab): Promise<MusicLibraryTabData> {
    const v = await api.request<unknown>(`${BASE}/library-tabs?tab=${tab}`);
    if (!isRecord(v)) throw bad();
    if (tab === 'history') { const songs = rows(v.songs); if (!songs) throw bad(); return { tab, songs }; }
    if (tab === 'hooks') { const hooks = rows(v.hooks); if (!hooks) throw bad(); return { tab, hooks }; }
    const images = rows(v.images); const covers = rows(v.covers);
    if (!images || !covers) throw bad();
    return { tab, images, covers };
}

// POST { action: 'listen', song_id }. Records one play in the listen history.
export async function recordListen(api: ApiClient, songId: string): Promise<void> {
    const v = await api.request<unknown>(`${BASE}/library-tabs`, post({ action: 'listen', song_id: songId }));
    if (!isRecord(v) || v.recorded !== true) throw bad();
}

// Songs list. `workspace`, `q` and `collection: 'trash'` need the library switch; without it the
// server answers 404 music_library_unavailable.
export async function listSongs(api: ApiClient, query: MusicSongsQuery = {}): Promise<readonly MusicRow[]> {
    const params = new URLSearchParams();
    if (query.limit !== undefined) params.set('limit', String(query.limit));
    if (query.workspace) params.set('workspace', query.workspace);
    if (query.q) params.set('q', query.q);
    if (query.collection) params.set('collection', query.collection);
    const qs = params.toString();
    const v = await api.request<unknown>(`${BASE}/songs${qs ? `?${qs}` : ''}`);
    const songs = isRecord(v) ? rows(v.songs) : null;
    if (!songs) throw bad();
    return songs;
}

export async function getSong(api: ApiClient, id: string): Promise<MusicSong> {
    const v = await api.request<unknown>(`${BASE}/songs/${encodeURIComponent(id)}`);
    if (!isRecord(v) || !Array.isArray(v.actions) || !v.actions.every((a) => typeof a === 'string')) throw bad();
    return v as MusicSong;
}

// PATCH trash | restore, with the song's current revision (a stale one answers a revision conflict).
export async function setSongLifecycle(api: ApiClient, id: string, action: 'trash' | 'restore', revision: number): Promise<{ song: MusicRow; idempotent: boolean }> {
    const v = await api.request<unknown>(`${BASE}/songs/${encodeURIComponent(id)}`, { ...post({ action, revision }), method: 'PATCH' });
    if (!isRecord(v) || !isRecord(v.song)) throw bad();
    return { song: v.song, idempotent: v.idempotent === true };
}

// Step 1 of create: an exact, short-lived price for two candidates. No credits move.
export async function createQuote(api: ApiClient, input: ({ mode?: 'simple' } & MusicSimpleQuoteInput) | ({ mode: 'custom' } & MusicCustomQuoteInput)): Promise<MusicQuote> {
    const v = await api.request<unknown>(`${BASE}/generation-quotes`, post(input));
    if (!isRecord(v) || typeof v.quote_id !== 'string' || !isFiniteNumber(v.total_credits) || !isFiniteNumber(v.balance_after)
        || !isFiniteNumber(v.credits_per_candidate) || typeof v.affordable !== 'boolean' || typeof v.expires_at !== 'string') {
        throw bad();
    }
    return v as unknown as MusicQuote;
}

// Step 2 of create: spends the quote. Reuse the SAME idempotency key (8-120 chars of A-Za-z0-9._-)
// on every retry; a replay answers 200 with idempotent:true and charges nothing more. A 503
// `pair_acceptance_unknown` means "replay the same key", never "make a new one".
export async function startGeneration(api: ApiClient, quoteId: string, idempotencyKey: string): Promise<MusicGeneration> {
    const v = await api.request<unknown>(`${BASE}/generations`, post({ quote_id: quoteId, idempotency_key: idempotencyKey }));
    if (!isRecord(v) || typeof v.generation_id !== 'string' || !Array.isArray(v.candidates) || !isFiniteNumber(v.balance_after)
        || !v.candidates.every((c) => isRecord(c) && typeof c.job_id === 'string' && isFiniteNumber(c.ordinal))) {
        throw bad();
    }
    return v as unknown as MusicGeneration;
}
