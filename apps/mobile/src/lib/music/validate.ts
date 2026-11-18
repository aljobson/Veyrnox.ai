import { isFiniteNumber, isRecord } from '../responseShapes';
import type { MusicEntitlements, MusicGeneration, MusicModel, MusicQuote } from './types';

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
