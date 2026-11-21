import { isRecord } from '../responseShapes';
import { publicUuid } from './validatePublic';
export const EXPORT_FORMATS = ['mp3', 'wav', 'flac'] as const;
export type ExportFormat = typeof EXPORT_FORMATS[number];
export const EXPORT_MIME = { mp3: 'audio/mpeg', wav: 'audio/wav', flac: 'audio/flac' } as const;
export type ExportQuote = Readonly<{
    id: string; format: ExportFormat; consumes_allowance: boolean; allowance: number;
    used: number; remaining_after: number; expires_at: string;
}>;
export type ExportStart = Readonly<{
    export: Readonly<{ id: string; state: 'ready' }>;
    allowance: Readonly<{ total: number; used: number; remaining: number }>; idempotent: boolean;
}>;
export type ExportFile = Readonly<{
    id: string; state: 'ready'; format: ExportFormat; mime_type: string; size_bytes: number; expires_in: number; url: string;
}>;
const integer = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;
export function isExportQuote(v: unknown, format: ExportFormat): v is { quote: ExportQuote } {
    if (!isRecord(v) || !isRecord(v.quote)) return false;
    const q = v.quote;
    return publicUuid(q.id) && q.format === format && typeof q.consumes_allowance === 'boolean'
        && integer(q.allowance) && integer(q.used) && q.used <= q.allowance && integer(q.remaining_after)
        && q.remaining_after === q.allowance - q.used - (q.consumes_allowance ? 1 : 0)
        && typeof q.expires_at === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(q.expires_at) && Number.isFinite(Date.parse(q.expires_at));
}
export function isExportStart(v: unknown): v is ExportStart {
    if (!isRecord(v) || !isRecord(v.export) || !isRecord(v.allowance)) return false;
    const a = v.allowance;
    return publicUuid(v.export.id) && v.export.state === 'ready' && typeof v.idempotent === 'boolean'
        && integer(a.total) && integer(a.used) && a.used <= a.total && integer(a.remaining) && a.remaining === a.total - a.used;
}
export function isExportFile(v: unknown, format: ExportFormat, id: string): v is { export: ExportFile } {
    if (!isRecord(v) || !isRecord(v.export)) return false;
    const f = v.export;
    if (!publicUuid(f.id) || f.id !== id || f.state !== 'ready' || f.format !== format || f.mime_type !== EXPORT_MIME[format]
        || !integer(f.size_bytes) || f.size_bytes <= 0 || typeof f.expires_in !== 'number' || !Number.isFinite(f.expires_in)
        || f.expires_in <= 0 || typeof f.url !== 'string') return false;
    try { const url = new URL(f.url); return url.protocol === 'https:' && !!url.host && !url.username && !url.password; }
    catch { return false; }
}
