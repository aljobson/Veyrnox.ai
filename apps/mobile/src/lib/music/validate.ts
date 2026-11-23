import { isFiniteNumber, isRecord } from '../responseShapes';
import type { MusicDraft, MusicCandidateView, MusicGenerationView, MusicEntitlements, MusicGeneration, MusicModel, MusicQuote, MusicSongRow, MusicSongDetail, MusicVersion, MusicHook, MusicShareLink, MusicLifecycle, MusicVersionCapabilities, MusicReuseContext } from './types';

// Boundary checks: every field the exported types promise is verified, so a screen never meets a
// missing nested field as a throw on access (the caller gets `bad_response` instead).
type Rec = Record<string, unknown>;
const str = (v: unknown): v is string => typeof v === 'string';
const bool = (v: unknown): v is boolean => typeof v === 'boolean';
const all = (r: Rec, keys: readonly string[], test: (v: unknown) => boolean): boolean => keys.every((k) => test(r[k]));

const contracts = ['fal-ace-v1', 'crun-suno-v1'] as const;
const sunoModels = ['v6', 'v6_mini', 'v6_wild'];
const genders = ['auto', 'male', 'female'];
const isContract = (v: unknown): boolean => contracts.includes(v as typeof contracts[number]);
const isPositiveInteger = (v: unknown): boolean => Number.isSafeInteger(v) && Number(v) > 0;
const isRange = (v: unknown): boolean => isRecord(v) && all(v, ['min', 'max'], isFiniteNumber) && Number(v.min) <= Number(v.max);
const isDuration = (v: unknown): boolean => isRecord(v) && all(v, ['min', 'max', 'default'], isFiniteNumber)
    && Number(v.min) <= Number(v.default) && Number(v.default) <= Number(v.max)
    && (v.custom_only === undefined || bool(v.custom_only));
const isCounters = (v: unknown): boolean => isRecord(v)
    && ['prompt', 'title', 'lyrics', 'styles', 'exclude_styles'].every(key => isRecord(v[key])
        && isPositiveInteger(v[key].max) && (v[key].applied === undefined
            || (Number.isSafeInteger(v[key].applied) && Number(v[key].applied) >= 0 && Number(v[key].applied) <= Number(v[key].max))));
const isLimits = (v: unknown): boolean => isRecord(v)
    && all(v, ['prompt', 'title', 'lyrics', 'styles', 'exclude_styles'], isPositiveInteger)
    && isDuration(v.duration_seconds)
    && (v.variety === undefined || isRange(v.variety))
    && (v.style_weight === undefined || isRange(v.style_weight))
    && (v.weirdness === undefined || isRange(v.weirdness));
const isFalControls = (v: unknown): boolean => isRecord(v)
    && all(v, ['description', 'seed', 'variety', 'style_influence', 'exclude_styles', 'tempo_key_meter', 'lyrics', 'styles'], bool)
    && (v.instrumental === 'optional' || v.instrumental === 'required')
    && isDuration(v.duration_seconds)
    && (v.duration_price_block_seconds === undefined || (isFiniteNumber(v.duration_price_block_seconds) && v.duration_price_block_seconds > 0));
const isSunoControls = (v: unknown): boolean => isRecord(v)
    && all(v, ['description', 'style_influence', 'exclude_styles', 'tempo_key_meter', 'lyrics', 'styles', 'weirdness'], bool)
    && (v.instrumental === 'optional' || v.instrumental === 'required')
    && (v.title === undefined || bool(v.title))
    && (v.lyrics_required_for_custom_vocal === undefined || bool(v.lyrics_required_for_custom_vocal))
    && Array.isArray(v.variety) && v.variety.every(str)
    && Array.isArray(v.suno_model) && v.suno_model.length > 0 && v.suno_model.every(x => sunoModels.includes(x as string))
    && Array.isArray(v.vocal_gender) && v.vocal_gender.every(x => genders.includes(x as string))
    && (v.duration_seconds === null || isDuration(v.duration_seconds));

export const isMusicModel = (v: unknown): v is MusicModel => isRecord(v)
    && str(v.id) && str(v.name)
    && (v.provider_contract === undefined || isContract(v.provider_contract))
    && Array.isArray(v.generation_modes) && v.generation_modes.every(str)
    && (v.provider_contract === 'crun-suno-v1' ? isSunoControls(v.controls) && isLimits(v.limits) && isCounters(v.counters) : isFalControls(v.controls))
    && (v.limits === undefined || isLimits(v.limits)) && (v.counters === undefined || isCounters(v.counters))
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
    && (v.custom_drafts.provider_contract === undefined || isContract(v.custom_drafts.provider_contract))
    && isRecord(v.features)
    && all(v.features, ['albums', 'inspiration', 'studioChat', 'dailyChallenge', 'persistentQueue'], bool)
    && isRecord(v.policy) && str(v.policy.version) && bool(v.policy.pre_debit);

export const isMusicQuote = (v: unknown): v is MusicQuote => isRecord(v)
    && all(v, ['quote_id', 'model_id', 'expires_at', 'policy_version'], str)
    && (v.mode === 'simple' || v.mode === 'custom')
    && all(v, ['output_count', 'credits_per_candidate', 'total_credits', 'balance', 'balance_after'], isFiniteNumber)
    && bool(v.affordable)
    && (v.provider_contract === undefined || isContract(v.provider_contract))
    && (v.suno_model === undefined || sunoModels.includes(v.suno_model as string))
    && (v.vocal_gender === undefined || genders.includes(v.vocal_gender as string))
    && optional(v, ['style_weight', 'weirdness'], x => isFiniteNumber(x) && Number(x) >= 0 && Number(x) <= 1)
    && optional(v, ['variety'], x => Number.isInteger(x) && Number(x) >= 0 && Number(x) <= 4)
    && optional(v, ['exclude_styles_applied_chars'], x => Number.isSafeInteger(x) && Number(x) >= 0);

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
    && nullableString(v.parent_version_id)
    && optional(v, ['mime_type'], str) && optional(v, ['size_bytes'], isFiniteNumber)
    && (v.capabilities === undefined || isMusicVersionCapabilities(v.capabilities));
export const isMusicVersionCapabilities = (v: unknown): v is MusicVersionCapabilities => isRecord(v)
    && all(v, ['render', 'crop'], bool)
    && optional(v, ['playback', 'download', 'remix', 'mashup', 'sample', 'stems', 'target_stem', 'track_add', 'cover', 'extend', 'replace_section', 'add_section'], bool);
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
    && (v.provider_contract === undefined || isContract(v.provider_contract))
    && all(v, ['model_id', 'lyrics', 'styles', 'title'], str);
export const isMusicReuseContext = (v: unknown): v is MusicReuseContext => isRecord(v) && isRecord(v.source)
    && nullableString(v.draft_id) && Number.isSafeInteger(v.draft_revision) && Number(v.draft_revision) >= 0
    && isContract(v.provider_contract);
export const isMusicCandidateView = (v: unknown): v is MusicCandidateView => isRecord(v)
    && isFiniteNumber(v.ordinal) && all(v, ['label', 'state'], str)
    && all(v, ['job_id', 'song_id', 'version_id', 'error_code', 'audio_url'], nullableString);
export const isMusicGenerationView = (v: unknown): v is MusicGenerationView => isRecord(v)
    && all(v, ['id', 'state', 'model_id', 'prompt', 'created_at'], str) && nullableString(v.title)
    && isFiniteNumber(v.total_credits) && Array.isArray(v.candidates) && v.candidates.every(isMusicCandidateView);
