import { isFiniteNumber, isRecord } from '../responseShapes';
import type { MusicActionQuote, StemStart, StemRequest, StemArchive, CropResult } from './actionTypes';
const str = (v: unknown): v is string => typeof v === 'string';
const fields = (v: Record<string, unknown>, keys: readonly string[], test: (value: unknown) => boolean) => keys.every(k => test(v[k]));
const date = (v: unknown) => str(v) && Number.isFinite(Date.parse(v));
const https = (v: unknown) => { if (!str(v)) return false; try { return new URL(v).protocol === 'https:'; } catch { return false; } };
export const isMusicActionQuote = (v: unknown): v is MusicActionQuote => isRecord(v)
    && fields(v, ['quote_id', 'model_id'], str) && date(v.expires_at)
    && fields(v, ['total_credits', 'balance', 'balance_after'], isFiniteNumber) && typeof v.affordable === 'boolean'
    && Array.isArray(v.outputs) && v.outputs.every(str);
export const isStemStart = (v: unknown): v is StemStart => isRecord(v)
    && fields(v, ['request_id', 'job_id', 'state'], str)
    && (v.balance_after === undefined || isFiniteNumber(v.balance_after)) && (v.idempotent === undefined || v.idempotent === true);
export const isStemRequest = (v: unknown): v is StemRequest => isRecord(v)
    && fields(v, ['id', 'song_id', 'source_version_id', 'job_id', 'model_id'], str) && date(v.created_at)
    && isFiniteNumber(v.credits) && str(v.state) && ['queued', 'running', 'ready', 'failed', 'refunded'].includes(v.state)
    && (v.archive_url === null || str(v.archive_url));
export const isStemArchive = (v: unknown): v is StemArchive => isRecord(v) && https(v.url)
    && v.mime_type === 'application/zip' && isFiniteNumber(v.size_bytes) && isFiniteNumber(v.expires_in);
export const isCropResult = (v: unknown): v is CropResult => isRecord(v) && str(v.version_id)
    && isFiniteNumber(v.version_number) && (v.render_state === 'canonical' || v.render_state === 'preview_only')
    && typeof v.idempotent === 'boolean' && (v.format === undefined || str(v.format));
