import { CryptoDigestAlgorithm, digest, randomUUID } from 'expo-crypto';
import { ApiError, type ApiClient, type ClientTask } from '../api';
import { validUploadUrl } from '../publishUploads';
import { isRecord } from '../responseShapes';
import { mixdownSaveAttempt, mixdownSources, planExport, type ExportRange, type SaveAttempt } from './exportShared';
import type { BeatDoc } from './doc';
import { uploadMixdown, type UploadRequestFactory } from './mixdownUpload';
export type MixdownTask = ClientTask & { signal: AbortSignal };
export type MixdownProbe = 'opening' | 'on' | 'off' | 'signedOut' | 'offline' | 'error';
export type SavedMixdown = { song_id: string; version_id: string; committed: boolean };
export const MIXDOWN_MAX_BYTES = 26_214_400;
export function preflightMixdownSave(doc: BeatDoc, range: ExportRange) {
    const plan = planExport(doc, { range, output: 'mix', bitDepth: 16, phone: true });
    if (44 + plan.frames * 4 > MIXDOWN_MAX_BYTES) throw new ApiError(400, 'mixdown_size_invalid');
}
const path = '/api/v1/music/mixdowns';
export function mixdownCode(error: unknown): string {
    if (error instanceof ApiError) {
        const envelope = error.body.error;
        return String(isRecord(envelope) ? envelope.code ?? error.code : error.code).toLowerCase();
    }
    return '';
}
export function checkMixdownTask(task: MixdownTask) {
    if (!task.user || !task.current() || task.signal.aborted) throw new ApiError(401, 'account_changed');
}
async function post<T>(api: ApiClient, task: MixdownTask, body: unknown): Promise<T> {
    checkMixdownTask(task);
    const result = await api.request<T>(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: task.signal }, { owner: task.user!, task });
    checkMixdownTask(task); return result;
}
export async function probeMixdownSave(api: ApiClient, task: MixdownTask): Promise<MixdownProbe> {
    try { await post(api, task, {}); return 'error'; }
    catch (error) {
        if (!task.current() || task.signal.aborted || (error instanceof ApiError && error.status === 401)) return 'signedOut';
        if (error instanceof ApiError && error.status === 404 && mixdownCode(error) === 'beat_library_save_unavailable') return 'off';
        if (error instanceof ApiError && error.status === 400) return 'on';
        return error instanceof ApiError && error.status === 0 ? 'offline' : 'error';
    }
}
export function mixdownErrorKey(error: unknown): string {
    if (error instanceof ApiError && error.status === 401) return 'beatExport.signIn';
    const code = mixdownCode(error);
    if (['network', 'network_error'].includes(code) || (error instanceof ApiError && error.status === 0)) return 'beatExport.offline';
    return ({ mixdown_size_invalid: 'beatExport.size', source_unavailable: 'beatExport.sourceUnavailable', account_frozen: 'beatExport.frozen',
        rights_required: 'beatExport.rightsRequired', rights_confirmation_required: 'beatExport.rightsRequired',
        reservation_closed: 'beatExport.expired', reservation_expired: 'beatExport.expired', idempotency_conflict: 'beatExport.changed',
        rate_limited: 'beatExport.rate', title_invalid: 'beatExport.titleInvalid' } as Record<string, string>)[code] ?? 'beatExport.saveError';
}
const uuid = (value: unknown): value is string => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
function validateResult(value: unknown): SavedMixdown {
    if (!isRecord(value) || !uuid(value.song_id) || !uuid(value.version_id) || typeof value.committed !== 'boolean') throw new ApiError(200, 'bad_response');
    return value as SavedMixdown;
}
export const validMixdownTitle = (title: string) => { const value = title.normalize('NFKC').trim(); return value.length > 0 && value.length <= 80; };
export type SavePhase = 'reserve' | 'upload' | 'commit';
/** A zero-credit local render: this route needs neither a quote nor AI consent/paywall gates (ADR-0346). */
export function createMixdownSaver(api: ApiClient, makeRequest: UploadRequestFactory = () => new XMLHttpRequest(),
    hash: (bytes: ArrayBuffer) => Promise<ArrayBuffer> = bytes => digest(CryptoDigestAlgorithm.SHA256, bytes)) {
    let attempt: SaveAttempt | null = null;
    const drop = () => { attempt = null; };
    async function save({ doc, range, title, rights, task, render, progress = () => {} }: {
        doc: BeatDoc; range: ExportRange; title: string; rights: boolean; task: MixdownTask;
        render(): Promise<ArrayBuffer>; progress?(phase: SavePhase, percent?: number): void;
    }): Promise<SavedMixdown> {
        try {
            checkMixdownTask(task);
            title = title.normalize('NFKC').trim();
            if (!validMixdownTitle(title)) throw new ApiError(400, 'title_invalid');
            const { songs, hasTakes } = mixdownSources(doc, { range });
            if (hasTakes && !rights) throw new ApiError(400, 'rights_required');
            preflightMixdownSave(doc, range);
            const bytes = await render(); checkMixdownTask(task);
            if (bytes.byteLength > MIXDOWN_MAX_BYTES) throw new ApiError(400, 'mixdown_size_invalid');
            const hashed = await hash(bytes); checkMixdownTask(task);
            const sha = Array.from(new Uint8Array(hashed), b => b.toString(16).padStart(2, '0')).join('');
            attempt = mixdownSaveAttempt(attempt, `${range}:${title}:${rights}`, sha, randomUUID);
            const key = attempt.key;
            progress('reserve');
            const reserved = await post<unknown>(api, task, { action: 'reserve', idempotency_key: key, title,
                size_bytes: bytes.byteLength, sha256: sha, duration_seconds: (bytes.byteLength - 44) / (48000 * 4),
                sources: songs, has_takes: hasTakes, rights_confirmed: hasTakes && rights });
            checkMixdownTask(task);
            const result = validateResult(reserved);
            if (result.committed) { checkMixdownTask(task); return result; }
            const reservation = reserved as Record<string, unknown>;
            if (typeof reservation.upload_url !== 'string' || !validUploadUrl(reservation.upload_url) || !isRecord(reservation.headers)) throw new ApiError(200, 'bad_response');
            const headers: Record<string, string> = {};
            for (const [name, value] of Object.entries(reservation.headers)) {
                if (['content-type', 'if-none-match'].includes(name.toLowerCase()) && typeof value === 'string') headers[name] = value;
            }
            progress('upload', 0); checkMixdownTask(task);
            await uploadMixdown(reservation.upload_url, headers, bytes, task, percent => progress('upload', percent), makeRequest);
            checkMixdownTask(task);
            progress('upload', 100); checkMixdownTask(task);
            progress('commit'); checkMixdownTask(task);
            const saved = validateResult(await post(api, task, { action: 'commit', idempotency_key: key, version_id: result.version_id }));
            checkMixdownTask(task);
            if (!saved.committed) throw new ApiError(200, 'bad_response');
            return saved;
        } catch (error) {
            if (!task.current() || task.signal.aborted || (error instanceof ApiError && error.status === 401) ||
                ['reservation_closed', 'reservation_expired', 'idempotency_conflict'].includes(mixdownCode(error))) drop();
            if (!task.current() || task.signal.aborted) throw new ApiError(401, 'account_changed');
            throw error;
        }
    }
    return { save, drop };
}
