import { isFiniteNumber, isRecord } from '../responseShapes';
import type { MusicDraft, MusicCandidateView, MusicGenerationView, MusicEntitlements, MusicGeneration, MusicModel, MusicQuote, MusicSongRow, MusicSongDetail, MusicVersion, MusicHook, MusicShareLink, MusicLifecycle } from './types';

// Boundary checks: every field the exported types promise is verified, so a screen never meets a
// missing nested field as a throw on access (the caller gets `bad_response` instead).
type Rec = Record<string, unknown>;
const str = (v: unknown): v is string => typeof v === 'string';
const bool = (v: unknown): v is boolean => typeof v === 'boolean';
const all = (r: Rec, keys: readonly string[], test: (v: unknown) => boolean): boolean => keys.every((k) => test(r[k]));

const isControls = (v: unknown): boolean => isRecord(v)
    && all(v, ['description', 'seed', 'variety', 'style_influence', 'exclude_styles', 'tempo_key_meter', 'lyrics', 'styles'], bool)
    && (v.instrumental === 'optional' || v.instrumental === 'required')
    && isRecord(v.duration_seconds) && all(v.duration_seconds, ['min', 'max', 'default'], isFiniteNumber);

export const isMusicModel = (v: unknown): v is MusicModel => isRecord(v)
    && str(v.id) && str(v.name)
    && Array.isArray(v.generation_modes) && v.generation_modes.every(str)
    && isControls(v.controls)
    && all(v, ['credits_per_candidate', 'total_credits'], isFiniteNumber)
    && all(v, ['instrumental_only', 'requires_paid_plan', 'available'], bool);

export const isMusicEntitlements = (v: unknown): v is MusicEntitlements => isRecord(v)
    && bool(v.available) && str(v.mode)
    && all(v, ['output_count', 'concurrency_limit', 'balance', 'free_credits'], isFiniteNumber)
    && (v.free_expires_at === null || str(v.free_expires_at))
    && Array.isArray(v.models) && v.models.every(isMusicModel)
    && isRecord(v.custom_drafts)
    && all(v.custom_drafts, ['available', 'autosave', 'generation_supported'], bool)
    && all(v.custom_drafts, ['lyrics_max', 'styles_max', 'title_max'], isFiniteNumber)
    && isRecord(v.policy) && str(v.policy.version) && bool(v.policy.pre_debit);

export const isMusicQuote = (v: unknown): v is MusicQuote => isRecord(v)
    && all(v, ['quote_id', 'model_id', 'expires_at', 'policy_version'], str)
    && (v.mode === 'simple' || v.mode === 'custom')
    && all(v, ['output_count', 'credits_per_candidate', 'total_credits', 'balance', 'balance_after'], isFiniteNumber)
    && bool(v.affordable);

export const isMusicGeneration = (v: unknown): v is MusicGeneration => isRecord(v)
    && str(v.generation_id) && str(v.state) && isFiniteNumber(v.balance_after)
    && (v.idempotent === undefined || v.idempotent === true)
    && Array.isArray(v.candidates)
    && v.candidates.every((c) => isRecord(c) && isFiniteNumber(c.ordinal) && all(c, ['label', 'job_id', 'state'], str));


const optional = (r: Rec, keys: readonly string[], test: (v: unknown) => boolean): boolean =>
    keys.every(k => r[k] === undefined || test(r[k]));
const nullableString = (v: unknown): boolean => v === null || str(v);
export const MUSIC_ASSET_PATH = /^\/api\/v1\/jobs\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/asset$(?![\s\S])/i;
export const isMusicSongRow = (v: unknown): v is MusicSongRow => isRecord(v)
    && all(v, ['id', 'title'], str)
    && optional(v, ['job_id', 'version_id', 'lifecycle_status', 'workspace_name'], str)
    && optional(v, ['audio_url'], nullableString) && optional(v, ['revision'], isFiniteNumber);
export const isMusicVersion = (v: unknown): v is MusicVersion => isRecord(v)
    && all(v, ['id', 'operation', 'created_at'], str) && isFiniteNumber(v.version_number)
    && nullableString(v.parent_version_id);
export const isMusicSongDetail = (v: unknown): v is MusicSongDetail => isRecord(v)
    && all(v, ['job_id', 'version_id'], str) && isMusicVersion(v.current_version)
    && Array.isArray(v.versions) && v.versions.every(x => isRecord(x) && bool(x.is_current) && isMusicVersion(x))
    && Array.isArray(v.actions) && v.actions.every(str) && isRecord(v.provenance) && isMusicSongRow(v);
export const isMusicHook = (v: unknown): v is MusicHook => isRecord(v)
    && all(v, ['id', 'song_id', 'song_title', 'title', 'created_at', 'audio_url'], str)
    && all(v, ['start_seconds', 'end_seconds'], isFiniteNumber);
// Shared semantic gate for list filtering and playback; shape validation remains independent.
export const isPlayableMusicHook = (v: unknown): v is MusicHook => isMusicHook(v)
    && MUSIC_ASSET_PATH.test(v.audio_url) && v.start_seconds >= 0 && v.end_seconds > v.start_seconds;
export const isShareLink = (v: unknown): v is MusicShareLink => isRecord(v)
    && all(v, ['id', 'version_id', 'created_at'], str) && nullableString(v.revoked_at);
export const isMusicLifecycle = (v: unknown): v is MusicLifecycle => isRecord(v)
    && all(v, ['id', 'lifecycle_status', 'updated_at'], str) && isFiniteNumber(v.revision);

export const isMusicDraft = (v: unknown): v is MusicDraft => isRecord(v)
    && nullableString(v.id) && nullableString(v.updated_at)
    && isFiniteNumber(v.revision) && Number.isInteger(v.revision) && v.revision >= 0
    && all(v, ['model_id', 'lyrics', 'styles', 'title'], str);
export const isMusicCandidateView = (v: unknown): v is MusicCandidateView => isRecord(v)
    && isFiniteNumber(v.ordinal) && all(v, ['label', 'state'], str)
    && all(v, ['job_id', 'song_id', 'version_id', 'error_code', 'audio_url'], nullableString);
export const isMusicGenerationView = (v: unknown): v is MusicGenerationView => isRecord(v)
    && all(v, ['id', 'state', 'model_id', 'prompt', 'created_at'], str) && nullableString(v.title)
    && isFiniteNumber(v.total_credits) && Array.isArray(v.candidates) && v.candidates.every(isMusicCandidateView);
