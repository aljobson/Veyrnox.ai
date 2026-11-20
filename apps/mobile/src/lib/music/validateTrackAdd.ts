import { isFiniteNumber, isRecord } from '../responseShapes';
import { MUSIC_PROMPT_MAX, MUSIC_LYRICS_MAX, MUSIC_TRACK_ADD_SOURCE_MAX } from './shared';
import type { MusicTrackAddQuote, TrackAddStart, TrackAddRequest, TrackAddAudio, TrackAddParameters } from './trackAddTypes';
const str = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0;
const date = (v: unknown) => str(v) && Number.isFinite(Date.parse(v));
const nonnegative = (v: unknown): v is number => isFiniteNumber(v) && v >= 0;
const mode = (v: unknown) => v === 'vocals' || v === 'instrumental';
const state = (v: unknown) => typeof v === 'string' && ['queued', 'running', 'ready', 'failed', 'refunded'].includes(v);
export function trackAddInputError(v: unknown): string | null {
    if (!isRecord(v) || !mode(v.mode)) return 'track_mode_invalid';
    if (!str(v.prompt) || v.prompt.trim().length > MUSIC_PROMPT_MAX) return 'prompt_invalid';
    const gender = v.vocal_gender ?? 'auto';
    if (v.vocal_gender === null || (typeof gender !== 'string' || !['auto', 'female', 'male'].includes(gender))) return 'vocal_gender_invalid';
    if (typeof v.lyrics !== 'string') return 'lyrics_invalid';
    if (v.mode === 'vocals') {
        if (!v.lyrics.trim() || v.lyrics.trim().length > MUSIC_LYRICS_MAX) return 'lyrics_invalid';
        if (v.lyrics_rights_confirmed !== true) return 'lyrics_rights_required';
    } else if (v.lyrics.trim() || v.lyrics_rights_confirmed !== false || gender !== 'auto') return 'lyrics_not_applicable';
    return null;
}
export const validTrackAdd = (v: unknown): v is TrackAddParameters => trackAddInputError(v) === null;
export const isMusicTrackAddQuote = (v: unknown): v is MusicTrackAddQuote => isRecord(v)
    && str(v.quote_id) && mode(v.mode) && date(v.expires_at) && typeof v.affordable === 'boolean'
    && ['upload_credits', 'track_credits', 'total_credits', 'balance'].every(k => nonnegative(v[k]))
    && isFiniteNumber(v.balance_after) && isFiniteNumber(v.source_duration_seconds)
    && v.source_duration_seconds > 0 && v.source_duration_seconds <= MUSIC_TRACK_ADD_SOURCE_MAX
    && Number(v.upload_credits) + Number(v.track_credits) === v.total_credits;
export const isTrackAddStart = (v: unknown): v is TrackAddStart => isRecord(v)
    && ['request_id', 'upload_job_id', 'track_job_id'].every(k => str(v[k])) && state(v.state)
    && (v.idempotent === undefined || v.idempotent === true)
    && (v.idempotent === true ? v.balance_after === undefined || isFiniteNumber(v.balance_after) : isFiniteNumber(v.balance_after));
export const isTrackAddRequest = (v: unknown): v is TrackAddRequest => isRecord(v)
    && ['id', 'song_id', 'source_version_id', 'upload_job_id', 'track_job_id'].every(k => str(v[k]))
    && mode(v.mode) && date(v.created_at) && state(v.state)
    && typeof v.stage === 'string' && ['source_upload', 'part_generation', 'complete'].includes(v.stage)
    && nonnegative(v.upload_credits) && nonnegative(v.track_credits);
export function isTrackAddAudio(v: unknown): v is TrackAddAudio {
    if (!isRecord(v) || !str(v.url) || (v.mime_type !== 'audio/mpeg' && v.mime_type !== 'audio/wav')
        || !nonnegative(v.size_bytes) || !isFiniteNumber(v.expires_in) || v.expires_in <= 0) return false;
    try { const url = new URL(v.url); return url.protocol === 'https:' && !!url.hostname && !url.username && !url.password; } catch { return false; }
}
