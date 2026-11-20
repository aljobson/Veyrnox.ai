import { isFiniteNumber, isRecord } from '../responseShapes';
import { MUSIC_TARGET_STEM_INSTRUMENTS, type TargetStemInstrument } from './shared';
import { isMusicActionQuote, isStemStart } from './validateActions';
import type { MusicTargetStemQuote, TargetStemStart, TargetStemRequest, TargetStemAsset, TargetStemKind } from './targetStemTypes';
const str = (v: unknown): v is string => typeof v === 'string' && v.length > 0;
const state = (v: unknown) => str(v) && ['queued', 'running', 'ready', 'failed', 'refunded'].includes(v);
const pair = (v: unknown) => Array.isArray(v) && v.length === 2 && v[0] === 'target' && v[1] === 'residual';
export const isTargetStemInstrument = (v: unknown): v is TargetStemInstrument =>
    typeof v === 'string' && (MUSIC_TARGET_STEM_INSTRUMENTS as readonly string[]).includes(v);
export const isMusicTargetStemQuote = (v: unknown): v is MusicTargetStemQuote => isRecord(v)
    && isTargetStemInstrument(v.instrument) && isFiniteNumber(v.source_duration_seconds) && v.source_duration_seconds > 0
    && pair(v.outputs) && isMusicActionQuote(v);
export const isTargetStemStart = (v: unknown): v is TargetStemStart => isStemStart(v) && state(v.state);
export const isTargetStemRequest = (v: unknown): v is TargetStemRequest => isRecord(v)
    && ['id', 'song_id', 'source_version_id', 'job_id', 'model_id'].every(k => str(v[k]))
    && str(v.created_at) && Number.isFinite(Date.parse(v.created_at)) && isFiniteNumber(v.credits)
    && isTargetStemInstrument(v.instrument) && state(v.state)
    && (v.state === 'ready' ? pair(v.outputs) : Array.isArray(v.outputs) && v.outputs.length === 0);
export const isTargetStemAsset = (v: unknown, kind: TargetStemKind): v is TargetStemAsset => {
    if (!isRecord(v) || !str(v.url)) return false;
    try { if (new URL(v.url).protocol !== 'https:') return false; } catch { return false; }
    return v.kind === kind && str(v.mime_type) && /^audio\/[^\s/]+$/.test(v.mime_type)
        && isFiniteNumber(v.size_bytes) && v.size_bytes >= 0 && isFiniteNumber(v.expires_in) && v.expires_in > 0;
};
