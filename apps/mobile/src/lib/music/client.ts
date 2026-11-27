import { getCacheUser } from '../appCache';
import { markTrackAddUnavailable } from './trackAddAvailability';
import { isMusicTrackAddQuote, isTrackAddStart, isTrackAddRequest, isTrackAddAudio, trackAddInputError } from './validateTrackAdd';
import type { TrackAddParameters } from './trackAddTypes';
import type { AddSectionParameters, ReplaceParameters, MusicAddSectionQuote, MusicReplaceQuote, ReplaceCommit } from './sectionActionTypes';
import { validSectionPosition, validSectionDuration, validSectionStyles, validSectionLyrics, validReplaceRange, isMusicAddSectionQuote, isMusicReplaceQuote, isReplaceCommit, isSectionUuid } from './validateSectionActions';
import type { MusicExtendQuote, MusicCoverQuote, GenerationActionStart } from './generationActionTypes';
import { isMusicExtendQuote, isMusicCoverQuote, parseGenerationActionStart, validActionPrompt, validSourceInfluence } from './validateGenerationActions';
import type { MusicRemixQuoteRequest, MusicRemixQuote, RemixActionKind } from './remixActionTypes';
import { isMusicRemixQuote } from './validateRemixActions';
import { parseMusicRemixQuote, type TargetStemInstrument } from './shared';
import type { MusicTargetStemQuote, TargetStemStart, TargetStemRequest, TargetStemAsset, TargetStemKind } from './targetStemTypes';
import { isMusicTargetStemQuote, isTargetStemStart, isTargetStemRequest, isTargetStemAsset } from './validateTargetStems';
import type { MusicActionQuote, StemStart, StemRequest, StemArchive, CropInput, CropResult } from './actionTypes';
import { isMusicActionQuote, isStemStart, isStemRequest, isStemArchive, isCropResult } from './validateActions';
import { ApiError, type ApiClient } from '../api';
import { isRecord } from '../responseShapes';
import { isMusicDraft, isMusicGenerationView, isMusicEntitlements, isMusicGeneration, isMusicInspirationResult, isMusicQuote, isMusicSongRow, isMusicSongDetail, isPlayableMusicHook, isMusicLifecycle, isMusicReuseContext, isMusicOwnedSource } from './validate';
import { isMusicDailyChallenge } from './dailyChallenge';
import type {
    MusicDraft, MusicDraftInput, MusicGenerationView, MusicCustomQuoteInput, MusicEntitlements, MusicGeneration, MusicInspirationResult, MusicLibraryTab, MusicLibraryTabData, MusicQuote,
    MusicRow, MusicSongRow, MusicLifecycle, MusicSimpleQuoteInput, MusicSong, MusicSongsQuery, MusicProviderContract, MusicReuseContext, MusicReuseInput, MusicInspirationSource, MusicOwnedSource, MusicSourceReservation,
} from './types';

// Typed client over /api/v1/music/*. Request and response shapes come from the route handlers
// (app/api/v1/music/**/route.js). Every function throws ApiError; wrap in probeMusic() to get an
// 'off' state instead of an exception when a feature is not switched on.
const BASE = '/api/v1/music';
const bad = (status = 200): ApiError => new ApiError(status, 'bad_response');
const rows = (value: unknown): readonly MusicRow[] | null => Array.isArray(value) && value.every(isRecord) ? value : null;
const post = (body: unknown): RequestInit => ({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const DEFAULT_MUSIC_FEATURES: MusicEntitlements['features'] = Object.freeze({
    albums: false, inspiration: false, studioChat: false, dailyChallenge: false, persistentQueue: false, sources: false,
});
const DISABLED_DAILY_ALLOWANCE = Object.freeze({ enabled: false });
const INSPIRATION_SOURCES = new Set(['audio', 'image', 'video_frames']);

export async function getEntitlements(api: ApiClient): Promise<MusicEntitlements> {
    const response = await api.request<unknown>(`${BASE}/entitlements`);
    // Mobile and web deploy independently. A server rollback that predates rollout capabilities must fail closed,
    // while a present but malformed capabilities object remains a bad response.
    const safeChallenge = isRecord(response) && isRecord(response.features)
        && response.features.dailyChallenge === true && isMusicDailyChallenge(response.daily_challenge)
        ? response.daily_challenge : undefined;
    const safeSources = isRecord(response) && Array.isArray(response.inspiration_sources)
        && response.inspiration_sources.every(source => typeof source === 'string' && INSPIRATION_SOURCES.has(source))
        && new Set(response.inspiration_sources).size === response.inspiration_sources.length
        ? response.inspiration_sources : [];
    const projectedFeatures = isRecord(response) && response.features === undefined
        ? DEFAULT_MUSIC_FEATURES : isRecord(response) ? response.features : undefined;
    const safeFeatures = isRecord(projectedFeatures) ? {
        ...projectedFeatures,
        // Mobile can deploy before the server projection. Missing is off; a malformed present value still fails validation.
        sources: projectedFeatures.sources === undefined ? false : projectedFeatures.sources,
        // A server may know the umbrella flag but not yet project the source contract.
        // Hide the native entry point until at least one safe picker is available.
        inspiration: projectedFeatures.inspiration === true && safeSources.length > 0,
    } : projectedFeatures;
    const inspirationEnabled = isRecord(safeFeatures) && safeFeatures.inspiration === true;
    const value = isRecord(response) ? {
        ...response,
        features: safeFeatures,
        inspiration_sources: inspirationEnabled ? safeSources : [],
        ...(response.daily_allowance === undefined ? { daily_allowance: DISABLED_DAILY_ALLOWANCE } : {}),
        ...(response.daily_challenge === undefined ? {} : { daily_challenge: safeChallenge }),
    } : response;
    if (!isMusicEntitlements(value)) throw bad();
    return value;
}

export const MUSIC_SOURCE_MAX_BYTES = 20 * 1024 * 1024;
export type MusicOwnedSourceFile = Readonly<{ uri: string; name: string; size: number; mimeType: 'audio/mpeg' | 'audio/wav' }>;
export type PutOwnedMusicSource = (reservation: Exclude<MusicSourceReservation, { source: MusicOwnedSource }>, file: MusicOwnedSourceFile,
    onProgress: (fraction: number) => void, signal: AbortSignal) => Promise<number>;

export function normalizeMusicSourceFile(file: Readonly<{ uri?: string; name?: string | null; size?: number; mimeType?: string | null }>): MusicOwnedSourceFile | null {
    const mimeType = file.mimeType === 'audio/x-wav' || file.mimeType === 'audio/wave' ? 'audio/wav' : file.mimeType;
    const name = file.name?.trim();
    if (!file.uri || !name || name.length > 180 || /[\u0000-\u001f]/.test(name)
        || !Number.isSafeInteger(file.size) || Number(file.size) < 1 || Number(file.size) > MUSIC_SOURCE_MAX_BYTES) return null;
    if (mimeType !== 'audio/mpeg' && mimeType !== 'audio/wav') return null;
    return { uri: file.uri, name, size: Number(file.size), mimeType };
}

const projectMusicOwnedSource = (source: MusicOwnedSource): MusicOwnedSource => ({
    id: source.id, filename: source.filename, mime_type: source.mime_type, size_bytes: source.size_bytes,
    duration_seconds: source.duration_seconds, status: source.status, created_at: source.created_at,
    rights_statement_version: source.rights_statement_version, preview_url: source.preview_url,
    preview_expires_in: source.preview_expires_in,
});

export async function listMusicSources(api: ApiClient): Promise<readonly MusicOwnedSource[]> {
    const value = await api.request<unknown>(`${BASE}/sources`);
    const sources = isRecord(value) ? value.sources : null;
    if (!Array.isArray(sources) || !sources.every(isMusicOwnedSource)) throw bad();
    return sources.map(source => projectMusicOwnedSource(source));
}

export async function reserveMusicSource(api: ApiClient, file: MusicOwnedSourceFile, idempotencyKey: string, signal?: AbortSignal): Promise<MusicSourceReservation> {
    const value = await api.request<unknown>(`${BASE}/sources`, { ...post({ action: 'reserve', content_type: file.mimeType,
        filename: file.name, idempotency_key: idempotencyKey, rights_confirmed: true, size_bytes: file.size }), ...(signal ? { signal } : {}) });
    if (isRecord(value) && isMusicOwnedSource(value.source) && value.idempotent === true) return { source: projectMusicOwnedSource(value.source), idempotent: true };
    if (!isRecord(value) || typeof value.id !== 'string' || typeof value.upload_url !== 'string' || !/^https:\/\//.test(value.upload_url)
        || (value.content_type !== 'audio/mpeg' && value.content_type !== 'audio/wav') || typeof value.idempotent !== 'boolean'
        || (value.headers !== undefined && (!isRecord(value.headers) || !Object.values(value.headers).every(v => typeof v === 'string')))) throw bad();
    return { id: value.id, upload_url: value.upload_url, content_type: value.content_type,
        headers: (value.headers ?? {}) as Record<string, string>, idempotent: value.idempotent };
}

export async function completeMusicSource(api: ApiClient, id: string, signal?: AbortSignal): Promise<MusicOwnedSource> {
    const value = await api.request<unknown>(`${BASE}/sources`, { ...post({ action: 'complete', id }), ...(signal ? { signal } : {}) });
    if (!isRecord(value) || !isMusicOwnedSource(value.source)) throw bad();
    return projectMusicOwnedSource(value.source);
}

export async function removeMusicSource(api: ApiClient, id: string): Promise<void> {
    const value = await api.request<unknown>(`${BASE}/sources`, { ...post({ id }), method: 'DELETE' });
    if (!isRecord(value) || value.ok !== true) throw bad();
}

const putOwnedMusicSource: PutOwnedMusicSource = async (reservation, file, onProgress, signal) => {
    // Stream from the picked cache file instead of materialising up to 20 MiB as a JS Blob.
    const { File, UploadTask, UploadType } = require('expo-file-system') as typeof import('expo-file-system');
    let task: InstanceType<typeof UploadTask> | undefined;
    try {
        task = new UploadTask(new File(file.uri), reservation.upload_url, { httpMethod: 'PUT', uploadType: UploadType.BINARY_CONTENT,
            headers: { ...reservation.headers, 'Content-Type': reservation.content_type }, signal, sessionType: 'background',
            onProgress: ({ bytesSent, totalBytes }) => { if (totalBytes > 0) onProgress(bytesSent / totalBytes); } });
        return (await task.uploadAsync()).status;
    } finally { task?.release(); }
};

export async function uploadMusicSource(api: ApiClient, file: MusicOwnedSourceFile, idempotencyKey: string,
    onProgress: (fraction: number) => void, signal: AbortSignal, put: PutOwnedMusicSource = putOwnedMusicSource): Promise<MusicOwnedSource> {
    const reservation = await reserveMusicSource(api, file, idempotencyKey, signal);
    if ('source' in reservation) return reservation.source;
    const status = await put(reservation, file, onProgress, signal);
    if ((status < 200 || status >= 300) && !(reservation.idempotent && status === 412)) {
        throw new ApiError(status, status === 403 ? 'upload_url_expired' : 'storage_upload_failed');
    }
    return completeMusicSource(api, reservation.id, signal);
}

export async function analyzeMusicInspiration(api: ApiClient, kind: MusicInspirationSource, key: string, idempotencyKey: string, signal?: AbortSignal): Promise<MusicInspirationResult> {
    const value = await api.request<unknown>(`${BASE}/inspiration`, { ...post({ kind, key,
        rights_confirmed: true, idempotency_key: idempotencyKey }), signal }, { timeoutMs: 75_000 });
    if (!isMusicInspirationResult(value)) throw bad();
    return value;
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
export const isContractStale = (error: unknown): error is ApiError => error instanceof ApiError
    && error.status === 409 && ['contract_stale', 'draft_stale'].includes(error.code);
// A contract or draft flip invalidates policy and/or draft identity. The caller rebuilds the
// payload from one fresh entitlement/draft read; the network request is retried once only.
export async function createQuoteWithContractRefresh(api: ApiClient, input: MusicSimpleQuoteInput | MusicCustomQuoteInput,
    refresh: () => Promise<MusicSimpleQuoteInput | MusicCustomQuoteInput>): Promise<MusicQuote> {
    try { return await createQuote(api, input); }
    catch (error) {
        if (!isContractStale(error)) throw error;
        return createQuote(api, await refresh());
    }
}

// Step 2 of create: spends the quote. Reuse the SAME idempotency key (8-120 chars of A-Za-z0-9._-)
// on every retry; a replay answers 200 with idempotent:true and charges nothing more. A 503
// `pair_acceptance_unknown` means "replay the same key", never "make a new one".
export async function startGeneration(api: ApiClient, quoteId: string, idempotencyKey: string, providerContract?: MusicProviderContract): Promise<MusicGeneration> {
    const v = await api.request<unknown>(`${BASE}/generations`, post({ quote_id: quoteId, idempotency_key: idempotencyKey,
        ...(providerContract ? { provider_contract: providerContract } : {}) }));
    if (!isMusicGeneration(v)) throw bad();
    return v;
}

export async function getCustomDraft(api: ApiClient): Promise<MusicDraft> {
    const v = await api.request<unknown>(`${BASE}/drafts/custom`);
    if (!isRecord(v) || !isMusicDraft(v.draft)) throw bad();
    if (v.provider_contract !== undefined && v.provider_contract !== 'fal-ace-v1' && v.provider_contract !== 'crun-suno-v1') throw bad();
    const draft = v.provider_contract && !v.draft.provider_contract ? { ...v.draft, provider_contract: v.provider_contract } : v.draft;
    if (!isMusicDraft(draft)) throw bad();
    return draft;
}
export async function saveCustomDraft(api: ApiClient, input: MusicDraftInput): Promise<MusicDraft> {
    const { revision, model_id, lyrics, styles, title, provider_contract, draft_id } = input;
    const v = await api.request<unknown>(`${BASE}/drafts/custom`, {
        ...post({ ...(provider_contract ? { provider_contract, draft_id: draft_id ?? null } : {}), revision, model_id, lyrics, styles, title }), method: 'PUT',
    });
    if (!isRecord(v) || !isMusicDraft(v.draft)) throw bad();
    const draft = provider_contract && !v.draft.provider_contract ? { ...v.draft, provider_contract } : v.draft;
    if (!isMusicDraft(draft)) throw bad();
    return draft;
}
export function conflictDraft(err: unknown): MusicDraft | null {
    return err instanceof ApiError && err.status === 409 && err.code === 'revision_conflict'
        && isMusicDraft(err.body.draft) ? err.body.draft : null;
}
export async function getReuseDraftContext(api: ApiClient, songId: string, versionId: string): Promise<MusicReuseContext> {
    const v = await api.request<unknown>(`${BASE}/songs/${encodeURIComponent(songId)}/reuse?version_id=${encodeURIComponent(versionId)}`);
    if (!isMusicReuseContext(v)) throw bad();
    return v;
}
export async function applyReuseToDraft(api: ApiClient, songId: string, input: MusicReuseInput): Promise<{ draft: MusicDraft; idempotent: boolean }> {
    const v = await api.request<unknown>(`${BASE}/songs/${encodeURIComponent(songId)}/reuse`, post(input));
    if (!isRecord(v) || !isMusicDraft(v.draft) || typeof v.idempotent !== 'boolean') throw bad();
    const draft = !v.draft.provider_contract ? { ...v.draft, provider_contract: input.provider_contract } : v.draft;
    if (!isMusicDraft(draft)) throw bad();
    return { draft, idempotent: v.idempotent };
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

export async function createRemixQuote(api: ApiClient, songId: string, input: MusicRemixQuoteRequest,
    expectedKind: RemixActionKind = input.kind): Promise<MusicRemixQuote> {
    const parsed = parseMusicRemixQuote(input);
    if (!parsed.ok) throw new ApiError(400, parsed.error);
    const v = await api.request<unknown>(`${BASE}/songs/${encodeURIComponent(songId)}`, post({
        phase: 'quote', ...input, prompt: parsed.prompt,
    }));
    if (!isMusicRemixQuote(v, expectedKind)) throw bad();
    return v;
}

export async function startRemix(api: ApiClient, songId: string, quoteId: string, key: string): Promise<GenerationActionStart> {
    const v = await api.request<unknown>(`${BASE}/songs/${encodeURIComponent(songId)}?phase=confirm`, post({
        phase: 'confirm', quote_id: quoteId, idempotency_key: key,
    }));
    const result = parseGenerationActionStart(v);
    if (!result) throw bad();
    return result;
}

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

async function trackAddRequest(api: ApiClient, path: string, init: RequestInit = {}) {
    const user = getCacheUser();
    try { return await api.request<unknown>(`${BASE}/${path}`, init, { timeoutMs: 15000 }); }
    catch (error) {
        if (getCacheUser() === user && error instanceof ApiError && error.status === 404 && error.code === 'music_track_add_unavailable') markTrackAddUnavailable();
        throw error;
    }
}
export async function createTrackAddQuote(api: ApiClient, songId: string, versionId: string, input: TrackAddParameters, rightsConfirmed: boolean) {
    const error = trackAddInputError(input);
    if (error) throw new ApiError(400, error);
    if (rightsConfirmed !== true) throw new ApiError(400, 'source_rights_required');
    const v = await trackAddRequest(api, `songs/${encodeURIComponent(songId)}/track-add-quotes`, post({
        version_id: versionId, mode: input.mode, prompt: input.prompt.trim(), lyrics: input.lyrics.trim(),
        vocal_gender: input.vocal_gender ?? 'auto', rights_confirmed: true, lyrics_rights_confirmed: input.lyrics_rights_confirmed,
    }));
    if (!isMusicTrackAddQuote(v) || v.mode !== input.mode) throw new ApiError(200, 'bad_response');
    return v;
}
export async function startTrackAdd(api: ApiClient, songId: string, quoteId: string, key: string) {
    const v = await trackAddRequest(api, `songs/${encodeURIComponent(songId)}/track-adds`, post({ quote_id: quoteId, idempotency_key: key }));
    if (!isTrackAddStart(v)) throw new ApiError(200, 'bad_response');
    return v;
}
export async function getTrackAdd(api: ApiClient, id: string) {
    const v = await trackAddRequest(api, `track-add-requests/${encodeURIComponent(id)}`);
    if (!isTrackAddRequest(v) || v.id !== id) throw new ApiError(200, 'bad_response');
    return v;
}
export async function getTrackAddAudio(api: ApiClient, id: string) {
    const v = await trackAddRequest(api, `track-add-requests/${encodeURIComponent(id)}/audio`);
    if (!isTrackAddAudio(v)) throw new ApiError(200, 'bad_response');
    return v;
}
