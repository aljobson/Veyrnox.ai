import type { AddSectionParameters, ReplaceParameters, MusicAddSectionQuote, MusicReplaceQuote, ReplaceCommit } from './sectionActionTypes';
import { validSectionPosition, validSectionDuration, validSectionStyles, validSectionLyrics, validReplaceRange, isMusicAddSectionQuote, isMusicReplaceQuote, isReplaceCommit, isSectionUuid } from './validateSectionActions';
import type { MusicExtendQuote, MusicCoverQuote, GenerationActionStart } from './generationActionTypes';
import { isMusicExtendQuote, isMusicCoverQuote, parseGenerationActionStart, validActionPrompt, validSourceInfluence } from './validateGenerationActions';
import type { TargetStemInstrument } from './shared';
import type { MusicTargetStemQuote, TargetStemStart, TargetStemRequest, TargetStemAsset, TargetStemKind } from './targetStemTypes';
import { isMusicTargetStemQuote, isTargetStemStart, isTargetStemRequest, isTargetStemAsset } from './validateTargetStems';
import type { MusicActionQuote, StemStart, StemRequest, StemArchive, CropInput, CropResult } from './actionTypes';
import { isMusicActionQuote, isStemStart, isStemRequest, isStemArchive, isCropResult } from './validateActions';
import { ApiError, type ApiClient } from '../api';
import { isRecord } from '../responseShapes';
import { isMusicDraft, isMusicGenerationView, isMusicEntitlements, isMusicGeneration, isMusicQuote, isMusicSongRow, isMusicSongDetail, isPlayableMusicHook, isMusicLifecycle } from './validate';
import type {
    MusicDraft, MusicDraftInput, MusicGenerationView, MusicCustomQuoteInput, MusicEntitlements, MusicGeneration, MusicLibraryTab, MusicLibraryTabData, MusicQuote,
    MusicRow, MusicSongRow, MusicLifecycle, MusicSimpleQuoteInput, MusicSong, MusicSongsQuery,
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
    if (!isMusicEntitlements(v)) throw bad();
    return v;
}

// GET ?tab=history|hooks|covers. The key in the answer depends on the tab.
export async function getLibraryTab(api: ApiClient, tab: MusicLibraryTab): Promise<MusicLibraryTabData> {
    const v = await api.request<unknown>(`${BASE}/library-tabs?tab=${tab}`);
    if (!isRecord(v)) throw bad();
    if (tab === 'history') { const songs = v.songs; if (!Array.isArray(songs) || !songs.every(isMusicSongRow)) throw bad(); return { tab, songs }; }
    if (tab === 'hooks') {
        if (!Array.isArray(v.hooks)) throw bad();
        // Preserve usable rows and tell the screen when this is only a partial result.
        const hooks = v.hooks.filter(isPlayableMusicHook);
        return { tab, hooks, dropped: v.hooks.length - hooks.length };
    }
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
export async function listSongs(api: ApiClient, query: MusicSongsQuery = {}): Promise<readonly MusicSongRow[]> {
    const params = new URLSearchParams();
    if (query.limit !== undefined) params.set('limit', String(query.limit));
    if (query.workspace) params.set('workspace', query.workspace);
    if (query.q !== undefined) params.set('q', query.q);
    if (query.collection) params.set('collection', query.collection);
    const qs = params.toString();
    const v = await api.request<unknown>(`${BASE}/songs${qs ? `?${qs}` : ''}`);
    const songs = isRecord(v) ? v.songs : null;
    if (!Array.isArray(songs) || !songs.every(isMusicSongRow)) throw bad();
    return songs;
}

export async function getSong(api: ApiClient, id: string): Promise<MusicSong> {
    const v = await api.request<unknown>(`${BASE}/songs/${encodeURIComponent(id)}`);
    if (!isMusicSongDetail(v)) throw bad();
    return v;
}

// PATCH trash | restore, with the song's current revision (a stale one answers a revision conflict).
export async function setSongLifecycle(api: ApiClient, id: string, action: 'trash' | 'restore', revision: number): Promise<{ song: MusicLifecycle; idempotent: boolean }> {
    const v = await api.request<unknown>(`${BASE}/songs/${encodeURIComponent(id)}`, { ...post({ action, revision }), method: 'PATCH' });
    if (!isRecord(v) || !isMusicLifecycle(v.song) || typeof v.idempotent !== 'boolean') throw bad();
    return { song: v.song, idempotent: v.idempotent === true };
}

// Step 1 of create: an exact, short-lived price for two candidates. No credits move.
export async function createQuote(api: ApiClient, input: MusicSimpleQuoteInput | MusicCustomQuoteInput): Promise<MusicQuote> {
    const v = await api.request<unknown>(`${BASE}/generation-quotes`, post(input));
    if (!isMusicQuote(v)) throw bad();
    return v;
}

// Step 2 of create: spends the quote. Reuse the SAME idempotency key (8-120 chars of A-Za-z0-9._-)
// on every retry; a replay answers 200 with idempotent:true and charges nothing more. A 503
// `pair_acceptance_unknown` means "replay the same key", never "make a new one".
export async function startGeneration(api: ApiClient, quoteId: string, idempotencyKey: string): Promise<MusicGeneration> {
    const v = await api.request<unknown>(`${BASE}/generations`, post({ quote_id: quoteId, idempotency_key: idempotencyKey }));
    if (!isMusicGeneration(v)) throw bad();
    return v;
}

export async function getCustomDraft(api: ApiClient): Promise<MusicDraft> {
    const v = await api.request<unknown>(`${BASE}/drafts/custom`);
    if (!isRecord(v) || !isMusicDraft(v.draft)) throw bad();
    return v.draft;
}
export async function saveCustomDraft(api: ApiClient, input: MusicDraftInput): Promise<MusicDraft> {
    const { revision, model_id, lyrics, styles, title } = input;
    const v = await api.request<unknown>(`${BASE}/drafts/custom`, {
        ...post({ revision, model_id, lyrics, styles, title }), method: 'PUT',
    });
    if (!isRecord(v) || !isMusicDraft(v.draft)) throw bad();
    return v.draft;
}
export function conflictDraft(err: unknown): MusicDraft | null {
    return err instanceof ApiError && err.status === 409 && err.code === 'revision_conflict'
        && isMusicDraft(err.body.draft) ? err.body.draft : null;
}
export async function getGeneration(api: ApiClient, id: string): Promise<MusicGenerationView> {
    const v = await api.request<unknown>(`${BASE}/generations/${encodeURIComponent(id)}`);
    if (!isMusicGenerationView(v) || v.id !== id) throw bad();
    return v;
}

// Song actions have a different quote/acceptance contract from P2 generation.
export async function createStemQuote(api: ApiClient, songId: string, versionId: string): Promise<MusicActionQuote> {
    const v = await api.request<unknown>(`${BASE}/songs/${encodeURIComponent(songId)}/stem-quotes`, post({ version_id: versionId, rights_confirmed: true }));
    if (!isMusicActionQuote(v)) throw bad();
    return v;
}
export async function startStems(api: ApiClient, songId: string, quoteId: string, key: string): Promise<StemStart> {
    const v = await api.request<unknown>(`${BASE}/songs/${encodeURIComponent(songId)}/stems`, post({ quote_id: quoteId, idempotency_key: key }));
    if (!isStemStart(v)) throw bad();
    return v;
}
export async function getStemRequest(api: ApiClient, id: string): Promise<StemRequest> {
    const v = await api.request<unknown>(`${BASE}/stem-requests/${encodeURIComponent(id)}`, {}, { timeoutMs: 15000 });
    if (!isStemRequest(v) || v.id !== id) throw bad();
    return v;
}
export async function getStemArchive(api: ApiClient, id: string): Promise<StemArchive> {
    const v = await api.request<unknown>(`${BASE}/stem-requests/${encodeURIComponent(id)}/archive`);
    if (!isStemArchive(v)) throw bad();
    return v;
}
export async function cropSong(api: ApiClient, songId: string, input: CropInput, key: string): Promise<CropResult> {
    const { version_id, start_seconds, end_seconds } = input;
    const v = await api.request<unknown>(`${BASE}/songs/${encodeURIComponent(songId)}/crop`, post({ version_id, start_seconds, end_seconds, idempotency_key: key }));
    if (!isCropResult(v)) throw bad();
    return v;
}
export async function createTargetStemQuote(api: ApiClient, songId: string, versionId: string, instrument: TargetStemInstrument): Promise<MusicTargetStemQuote> {
    const v = await api.request<unknown>(`${BASE}/songs/${encodeURIComponent(songId)}/target-stem-quotes`, post({ version_id: versionId, instrument, rights_confirmed: true }));
    if (!isMusicTargetStemQuote(v) || v.instrument !== instrument) throw bad();
    return v;
}
export async function startTargetStems(api: ApiClient, songId: string, quoteId: string, key: string): Promise<TargetStemStart> {
    const v = await api.request<unknown>(`${BASE}/songs/${encodeURIComponent(songId)}/target-stems`, post({ quote_id: quoteId, idempotency_key: key }));
    if (!isTargetStemStart(v)) throw bad();
    return v;
}
export async function getTargetStemRequest(api: ApiClient, id: string): Promise<TargetStemRequest> {
    const v = await api.request<unknown>(`${BASE}/target-stem-requests/${encodeURIComponent(id)}`, {}, { timeoutMs: 15000 });
    if (!isTargetStemRequest(v) || v.id !== id) throw bad();
    return v;
}
export async function getTargetStemAsset(api: ApiClient, id: string, kind: TargetStemKind): Promise<TargetStemAsset> {
    const v = await api.request<unknown>(`${BASE}/target-stem-requests/${encodeURIComponent(id)}/${kind}`);
    if (!isTargetStemAsset(v, kind)) throw bad();
    return v;
}

export async function createExtendQuote(api: ApiClient, songId: string, versionId: string, prompt: string): Promise<MusicExtendQuote> {
    if (!validActionPrompt(prompt)) throw new ApiError(400, 'prompt_invalid');
    const v = await api.request<unknown>(`${BASE}/songs/${encodeURIComponent(songId)}/extend-quotes`, post({ version_id: versionId, prompt: prompt.trim(), rights_confirmed: true }));
    if (!isMusicExtendQuote(v)) throw bad();
    return v;
}
export async function createCoverQuote(api: ApiClient, songId: string, versionId: string, prompt: string, sourceInfluence: number): Promise<MusicCoverQuote> {
    if (!validActionPrompt(prompt)) throw new ApiError(400, 'prompt_invalid');
    if (!validSourceInfluence(sourceInfluence)) throw new ApiError(400, 'source_influence_invalid');
    const v = await api.request<unknown>(`${BASE}/songs/${encodeURIComponent(songId)}/cover-quotes`, post({ version_id: versionId, prompt: prompt.trim(), source_influence: sourceInfluence, rights_confirmed: true }));
    if (!isMusicCoverQuote(v) || v.source_influence !== sourceInfluence) throw bad();
    return v;
}
async function startPairAction(api: ApiClient, songId: string, route: 'extends' | 'covers', quoteId: string, key: string): Promise<GenerationActionStart> {
    const v = await api.request<unknown>(`${BASE}/songs/${encodeURIComponent(songId)}/${route}`, post({ quote_id: quoteId, idempotency_key: key }));
    const result = parseGenerationActionStart(v);
    if (!result) throw bad();
    return result;
}
export const startExtend = (api: ApiClient, songId: string, quoteId: string, key: string) => startPairAction(api, songId, 'extends', quoteId, key);
export const startCover = (api: ApiClient, songId: string, quoteId: string, key: string) => startPairAction(api, songId, 'covers', quoteId, key);

export async function createAddSectionQuote(api: ApiClient, songId: string, versionId: string, input: AddSectionParameters): Promise<MusicAddSectionQuote> {
    if (!validSectionPosition(input.position)) throw new ApiError(400, 'section_position_invalid');
    if (!validSectionDuration(input.duration_seconds)) throw new ApiError(400, 'section_duration_invalid');
    if (!validSectionStyles(input.styles)) throw new ApiError(400, 'styles_invalid');
    if (!validSectionLyrics(input.lyrics)) throw new ApiError(400, 'lyrics_invalid');
    const { position, duration_seconds } = input;
    const v = await api.request<unknown>(`${BASE}/songs/${encodeURIComponent(songId)}/add-section-quotes`, post({
        version_id: versionId, position, duration_seconds, styles: input.styles.trim(),
        ...(input.lyrics === undefined ? {} : { lyrics: input.lyrics.trim() }), rights_confirmed: true,
    }));
    if (!isMusicAddSectionQuote(v) || v.position !== position || v.duration_seconds !== duration_seconds || v.instrumental !== !input.lyrics?.trim()) throw bad();
    return v;
}
export async function createReplaceQuote(api: ApiClient, songId: string, versionId: string, input: ReplaceParameters): Promise<MusicReplaceQuote> {
    if (!validActionPrompt(input.prompt)) throw new ApiError(400, 'prompt_invalid');
    if (!validReplaceRange(input.start_seconds, input.end_seconds)) throw new ApiError(400, 'range_invalid');
    const { start_seconds, end_seconds } = input;
    const v = await api.request<unknown>(`${BASE}/songs/${encodeURIComponent(songId)}/replace-quotes`, post({
        version_id: versionId, prompt: input.prompt.trim(), start_seconds, end_seconds, rights_confirmed: true,
    }));
    if (!isMusicReplaceQuote(v) || v.start_seconds !== start_seconds || v.end_seconds !== end_seconds) throw bad();
    return v;
}
export async function startAddSection(api: ApiClient, songId: string, quoteId: string, key: string): Promise<GenerationActionStart> {
    return startSectionPair(api, songId, 'sections', quoteId, key);
}
export async function startReplace(api: ApiClient, songId: string, quoteId: string, key: string): Promise<GenerationActionStart> {
    return startSectionPair(api, songId, 'replacements', quoteId, key);
}
async function startSectionPair(api: ApiClient, songId: string, route: string, quoteId: string, key: string): Promise<GenerationActionStart> {
    const v = await api.request<unknown>(`${BASE}/songs/${encodeURIComponent(songId)}/${route}`, post({ quote_id: quoteId, idempotency_key: key }));
    const result = parseGenerationActionStart(v); if (!result) throw bad(); return result;
}
export const replaceCommitKey = (generationId: string, versionId: string) => `replace-commit.${generationId}.${versionId}`;
export async function commitReplaceTake(api: ApiClient, songId: string, generationId: string, versionId: string): Promise<ReplaceCommit> {
    if (!isSectionUuid(generationId) || !isSectionUuid(versionId)) throw new ApiError(400, 'invalid_request');
    const v = await api.request<unknown>(`${BASE}/songs/${encodeURIComponent(songId)}/replacements/commit`, post({
        generation_id: generationId, version_id: versionId, idempotency_key: replaceCommitKey(generationId, versionId),
    }));
    if (!isReplaceCommit(v) || v.version_id !== versionId) throw bad(); return v;
}
