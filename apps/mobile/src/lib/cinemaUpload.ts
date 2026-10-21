import { ApiError, type ApiClient } from './api';
import { jsonWrite, MAX_UPLOAD_BYTES, UPLOAD_CHUNK_BYTES } from './cinemaDrafts';
import type { UploadRecord } from './cinemaUploadStore';
export { MAX_UPLOAD_BYTES, UPLOAD_CHUNK_BYTES } from './cinemaDrafts';
export const CINEMA_DEVICE_UPLOAD_ENABLED = process.env.EXPO_PUBLIC_CINEMA_DEVICE_UPLOAD_ENABLED === 'true';
export interface Upload {
    id: string; content_id: string; state: string; fingerprint: string; file_size: number;
    transfer_path: string | null; expires_at?: string; duration_seconds?: number; width?: number; height?: number;
}
export interface UploadReply { upload: Upload | null; proxy_uploads_enabled: boolean; library_uploads_enabled?: boolean }
export type Cleanup = 'keep' | 'delete' | 'ask';
export function cleanupFor(operation: string, outcome: string | { status: number; code: string }): Cleanup {
    if (typeof outcome !== 'string') {
        if (outcome.status === 0 || outcome.status === 408 || outcome.status === 429 || outcome.status >= 500) return 'keep';
        if (outcome.status === 410 && outcome.code === 'upload_removed') return 'delete';
        if (outcome.status === 409 && outcome.code === 'upload_exists') return 'ask';
        if (operation === 'start' && outcome.status === 409 && outcome.code === 'idempotency_conflict') return 'delete';
        return 'keep';
    }
    if (outcome === 'fingerprint_mismatch') return 'ask';
    return ['processing', 'ready', 'error', 'deleting', 'last_part_confirmed', 'remove_accepted', 'cancel_confirmed', 'owner_change', 'discard_confirmed'].includes(outcome) ? 'delete' : 'keep';
}
export function requireDeviceUploads() {
    if (!CINEMA_DEVICE_UPLOAD_ENABLED) throw new ApiError(503, 'uploads_not_open');
}
export async function startUpload(api: Pick<ApiClient, 'request'>, record: UploadRecord) {
    requireDeviceUploads();
    return jsonWrite<UploadReply>(api, '/api/v1/cinema/uploads', { content_id: record.contentId, file_size: record.size, fingerprint: record.fingerprint }, record.startKey);
}
export const readUpload = (api: Pick<ApiClient, 'request'>, contentId: string) =>
    api.request<UploadReply>(`/api/v1/cinema/uploads?content_id=${encodeURIComponent(contentId)}`);
export interface TransferDeps {
    api: Pick<ApiClient, 'request' | 'stream'>; record: UploadRecord;
    file: { offset: number | null; readBytes(n: number): Promise<Uint8Array<ArrayBuffer>> };
    live(): boolean; stopped(): boolean; sleep(ms: number): Promise<void>;
    save(record: UploadRecord): Promise<void>; clear(): Promise<void>;
    refresh(): Promise<unknown>; onUpload?(upload: Upload | null): void; onProgress?(record: UploadRecord): void; onError?(error: ApiError): void;
}
export type TransferResult = 'paused' | 'stale' | 'complete' | 'status';
const PATH = /^\/cinema\/uploads\/([a-f0-9-]{36})\/transfer\?content_id=([a-f0-9-]{36})$/;
const stopped = (d: TransferDeps): TransferResult | null => !d.live() ? 'stale' : d.stopped() ? 'paused' : null;
function offsetOf(value: { offset: number; length: number }, size: number) {
    if (value.length !== size || !Number.isSafeInteger(value.offset) || value.offset < 0 || value.offset > size) throw new ApiError(409, 'invalid_offset');
    return value.offset;
}
// No native APIs, timers, or UI here. A pause never aborts an in-flight part.
export async function runTransfer(d: TransferDeps): Promise<TransferResult> {
    requireDeviceUploads();
    let record = { ...d.record }, networkFailures = 0, invalidBodies = 0;
    let stage: 'start' | 'read' | 'head' | 'patch' = record.uploadId ? 'read' : 'start';
    let path = '';
    while (true) {
        const stop = stopped(d); if (stop) return stop;
        try {
            if (stage === 'start') {
                const result = await startUpload(d.api, record); if (!d.live()) return 'stale';
                if (result.upload) record.uploadId = result.upload.id;
                await d.save(record); if (!d.live()) return 'stale';
                stage = 'read';
            } else if (stage === 'read') {
                const result = await readUpload(d.api, record.contentId); if (!d.live()) return 'stale';
                const u = result.upload; d.onUpload?.(u);
                if (!u) throw new ApiError(410, 'upload_removed');
                if (cleanupFor('read', u.state) === 'delete') { await d.clear(); return d.live() ? 'status' : 'stale'; }
                if (u.fingerprint !== record.fingerprint) throw new ApiError(409, 'upload_exists');
                record.uploadId = u.id;
                if (u.state !== 'uploading') return 'status';
                const match = u.transfer_path?.match(PATH);
                if (!match || match[1] !== u.id || match[2] !== record.contentId) throw new ApiError(409, 'invalid_transfer_path');
                path = '/api/v1' + u.transfer_path;
                stage = 'head';
            } else if (stage === 'head') {
                const result = await d.api.request<{ offset: number; length: number }>(path); if (!d.live()) return 'stale';
                record.offset = offsetOf(result, record.size);
                await d.save(record); if (!d.live()) return 'stale';
                d.onProgress?.({ ...record }); stage = 'patch';
            } else {
                if (record.offset === record.size) {
                    // Even a failed refresh cannot justify retaining a fully transferred private copy.
                    try { await d.refresh(); } finally { if (d.live() && cleanupFor('transfer', 'last_part_confirmed') === 'delete') await d.clear(); }
                    return d.live() ? 'complete' : 'stale';
                }
                d.file.offset = record.offset;
                const count = Math.min(UPLOAD_CHUNK_BYTES, record.size - record.offset);
                const bytes = await d.file.readBytes(count); if (!d.live()) return 'stale';
                if (d.stopped()) return 'paused';
                if (bytes.length !== count || record.size > MAX_UPLOAD_BYTES) throw new ApiError(400, 'unreadable_video');
                const response = await d.api.stream(path, { method: 'PATCH', headers: {
                    'Content-Type': 'application/offset+octet-stream', 'Upload-Offset': String(record.offset),
                }, body: bytes }); if (!d.live()) return 'stale';
                const result = await response.json(); if (!d.live()) return 'stale';
                if (!response.ok) throw new ApiError(response.status, typeof result.error === 'string' ? result.error : 'unknown');
                const next = offsetOf(result, record.size);
                if (next !== record.offset + count) throw new ApiError(409, 'invalid_offset');
                record.offset = next;
                await d.save(record); if (!d.live()) return 'stale';
                d.onProgress?.({ ...record }); networkFailures = 0; invalidBodies = 0;
                if (record.offset === record.size) {
                    try { await d.refresh(); } finally { if (d.live() && cleanupFor('transfer', 'last_part_confirmed') === 'delete') await d.clear(); }
                    return d.live() ? 'complete' : 'stale';
                }
            }
        } catch (error) {
            if (!d.live()) return 'stale';
            const e = error instanceof ApiError ? error : new ApiError(0, 'network');
            if (cleanupFor(stage, e) === 'delete') { d.onError?.(e); await d.clear(); if (!d.live()) return 'stale'; }
            if (e.code !== 'invalid_body') invalidBodies = 0;
            if (e.status === 0) {
                if (++networkFailures >= 6) return 'paused';
                await d.sleep([2000, 4000, 8000, 16000, 30000][networkFailures - 1]);
                if (!d.live()) return 'stale';
                if (stage === 'patch') stage = 'head';
                continue;
            }
            if (e.status === 429) { await d.sleep(60000); if (!d.live()) return 'stale'; continue; }
            if (e.status === 400 && e.code === 'invalid_body') {
                if (++invalidBodies >= 2) throw new ApiError(400, 'slow_connection');
                stage = 'head'; continue;
            }
            invalidBodies = 0;
            if (e.status === 409 && e.code === 'upload_offset_conflict') { stage = 'head'; continue; }
            if (e.status === 409 && e.code === 'upload_not_writable') { stage = 'read'; continue; }
            throw e;
        }
    }
}
