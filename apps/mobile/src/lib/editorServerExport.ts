import { ApiError, type ApiClient } from './api';
import { getCacheUser, subscribeCacheUser } from './appCache';
import { documentIdentity, type ProjectDocument } from './editorBridge';
import { DEFAULT_TEXT_STYLE, type Media, type Timeline } from './nativeEditorModel';
import { mediaApi } from './media';
import { fetchFileLink } from './libraryFiles';
import { probeDuration } from './editorMediaDuration';
import type { DeviceFile } from './editorDeviceMedia';
import { fileRefusal, type ExportFile } from './editorServerExportUploads';
import { checkExportBody, UUID, type ExportRecord } from './editorServerExportStore';
import { OfflineError, OFFLINE_PAID_MESSAGE, requireOnline } from './network';
import { CONSENT_DECLINED_MESSAGE } from './aiConsent';
import { t } from './i18n';

export const RENDER_PATH = '/api/v1/editor/server-render';
export const JSON_HEADERS = { 'Content-Type': 'application/json' };
// A completed local backup changes persistence metadata, not the export snapshot.
export function exportIdentity(document: ProjectDocument): string {
    const copy = JSON.parse(JSON.stringify(document)) as ProjectDocument;
    for (const media of Object.values((copy.timeline as Timeline | undefined)?.media ?? {})) {
        if (media.id.startsWith('l-')) delete media.assetSource;
    }
    return documentIdentity(copy);
}
const SOURCE = /^([jef])-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;
export type BlockReason = 'notOnPhone' | 'unsupported' | 'durationUnknown' | 'clipLongerThanFile' | 'localType' | 'localSize' | 'localCount';
export type Blocked = { id: string; name?: string; reason: BlockReason };
export async function exportSourceLink(api: ApiClient, media: Media): Promise<string | null> {
    const match = SOURCE.exec(media.id);
    if (!match || !['video', 'audio'].includes(media.kind || '')) return null;
    try {
        if (match[1] === 'j') {
            const link = await mediaApi(api).getAsset(match[2]);
            return link.url?.startsWith('https://') && link.mime_type?.startsWith(`${media.kind}/`) ? link.url : null;
        }
        const link = await fetchFileLink(api, match[1] === 'e' ? 'renders' : 'masters', match[2]);
        return link?.mimeType.startsWith(`${media.kind}/`) ? link.url : null;
    } catch { return null; }
}
export async function exportDurations(api: ApiClient, document: ProjectDocument, files: Record<string, DeviceFile>): Promise<Record<string, number | null>> {
    const timeline = document.timeline as Timeline | undefined;
    const used = new Set([...(timeline?.video ?? []), ...(timeline?.audio ?? [])].map(c => c.mediaId));
    const durations: Record<string, number | null> = {};
    for (const media of Object.values(timeline?.media ?? {})) {
        if (!used.has(media.id) || !['video', 'audio'].includes(media.kind || '')) continue;
        const file = files[media.id];
        if (media.id.startsWith('l-') && file) durations[media.id] = file.verified && Number.isFinite(file.seconds) && file.seconds! > 0 ? file.seconds! : await probeDuration(file.file);
        else if (SOURCE.test(media.id)) { const link = await exportSourceLink(api, media); durations[media.id] = link ? await probeDuration(link) : null; }
    }
    return durations;
}
// Only this copy is translated. Unsupported features remain available to the server's validator.
export function exportCopy(saved: ProjectDocument, localFiles: Record<string, DeviceFile>, durations: Record<string, number | null> = {}) {
    const document: ProjectDocument = JSON.parse(JSON.stringify(saved));
    const uploads: ExportFile[] = [], blocked: Blocked[] = [];
    const timeline = document.timeline as Timeline | undefined;
    if (!timeline) return { document, uploads, blocked };
    const clips = [...timeline.video, ...timeline.audio];
    const used = new Set(clips.map(c => c.mediaId));
    timeline.media = Object.fromEntries(Object.entries(timeline.media).filter(([id]) => used.has(id)));
    for (const clip of [...clips, ...timeline.text]) {
        if ('rate' in clip && clip.rate === 1) delete clip.rate;
        delete clip.groupId;
    }
    for (const text of timeline.text) if (documentIdentity(text.style) === documentIdentity(DEFAULT_TEXT_STYLE)) delete text.style;
    for (const [id, media] of Object.entries(timeline.media)) {
        const block = (reason: BlockReason) => blocked.push({ id, name: media.name, reason });
        const file = localFiles[id];
        if (id.startsWith('p-') || (id.startsWith('l-') && !file)) { block('notOnPhone'); continue; }
        if (id.startsWith('l-') && UUID.test(id.slice(2))) {
            delete media.assetSource;
            const upload = { ...file, id, name: media.name };
            const refusal = fileRefusal(upload);
            if (refusal) { block(refusal); continue; }
            uploads.push(upload);
        } else if (!SOURCE.test(id)) { block('unsupported'); continue; }
        if (!['video', 'audio'].includes(media.kind || '')) continue;
        const seconds = durations[id] ?? (file?.verified ? file.seconds : undefined);
        if (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds <= 0) { block('durationUnknown'); continue; }
        media.frames = Math.floor(seconds * 30);
        if (clips.some(c => c.mediaId === id && (c.in ?? 0) + c.len > media.frames!)) block('clipLongerThanFile');
    }
    if (uploads.length > 10) blocked.push({ id: '', reason: 'localCount' });
    return { document, uploads, blocked };
}
export function remapExport(document: ProjectDocument, mapping: Map<string, string>): ProjectDocument {
    const copy = JSON.parse(JSON.stringify(document)) as ProjectDocument;
    const timeline = copy.timeline as Timeline;
    timeline.media = Object.fromEntries(Object.entries(timeline.media).map(([id, media]) => { const next = mapping.get(id) ?? id; return [next, { ...media, id: next }]; }));
    for (const clip of [...timeline.video, ...timeline.audio]) if (clip.mediaId) clip.mediaId = mapping.get(clip.mediaId) ?? clip.mediaId;
    return copy;
}
export function freezeExport<T>(value: T): T {
    if (value && typeof value === 'object') { Object.values(value).forEach(freezeExport); Object.freeze(value); }
    return value;
}
export const exportLabel = (name: string) => name.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 160) || t('editorServerExport.title');
let disabledOwner: string | undefined;
subscribeCacheUser(() => { disabledOwner = undefined; });
export const exportUnavailable = () => !!getCacheUser() && disabledOwner === getCacheUser();
export const rememberExportUnavailable = () => { disabledOwner = getCacheUser(); };
export const isGateRefusal = (error: unknown) => { const e = error as ApiError; return e.status === 501 || e.status === 404 || (e.status === 403 && e.code === 'preview_only') || e.code === 'not_enabled'; };
export const uncertainAttempt = (error: unknown) => { const e = error as ApiError; return e.status === 0 || (e.status >= 500 && !e.body?.job_id); };
export const retiredAttempt = (error: unknown) => { const e = error as ApiError; return ['price_changed', 'render_refunded'].includes(e.code) || (e.status === 503 && !!e.body?.job_id); };
export type RenderReply = { job_id: string; state: string; render_id?: string; refunded?: boolean; credits?: number };
export function renderStatus(reply: RenderReply) {
    return { jobId: UUID.test(reply.job_id || '') ? reply.job_id : null, renderId: UUID.test(reply.render_id || '') ? reply.render_id! : null,
        phase: ['STORED', 'succeeded'].includes(reply.state) ? 'done' as const : ['REFUNDED', 'FAILED', 'failed'].includes(reply.state) ? 'failed' as const : 'rendering' as const,
        refunded: reply.refunded === true || reply.state === 'REFUNDED' };
}
export async function sendExportAttempt(api: ApiClient, attempt: ExportRecord, live = () => attempt.owner === getCacheUser(), retries = 1): Promise<RenderReply> {
    checkExportBody(attempt.body);
    const body = JSON.stringify(attempt.body);
    for (let tries = 0; ; tries++) {
        requireOnline();
        if (!live()) throw new ApiError(0, 'account_changed');
        try {
            const reply = await api.request<RenderReply>(RENDER_PATH, { method: 'POST', headers: { ...JSON_HEADERS, 'Idempotency-Key': attempt.key }, body });
            if (!UUID.test(reply?.job_id || '')) throw new ApiError(0, 'unreadable_response');
            return reply;
        } catch (error) { if (!live() || tries >= retries || !uncertainAttempt(error)) throw error; }
    }
}
const ERRORS: Record<string, string> = {
    upload_budget_exceeded: 'uploadBudget', too_many_pending_uploads: 'uploadBudget', upload_admission_unavailable: 'uploadAdmission',
    upload_consent_expired: 'uploadExpired', upload_reservation_unavailable: 'uploadFailed', upload_invalid_grant: 'uploadFailed', upload_failed: 'uploadFailed', upload_unreadable: 'localType', upload_type_mismatch: 'localType',
    render_busy: 'refunded', runner_submit_failed: 'refunded', editor_render_unsupported: 'unsupported', editor_render_duration_limit: 'duration', editor_render_clip_limit: 'clips',
    editor_render_media_not_owned: 'ownership', editor_render_upload_incomplete: 'uploadFailed', insufficient_balance: 'balanceLow', insufficient_credits: 'balanceLow',
    rate_limited: 'rate', render_limit: 'rate', render_invalid: 'invalid', invalid_render: 'invalid', editor_render_invalid_document: 'invalid', render_too_large: 'tooLarge',
    render_refunded: 'refunded', editor_server_render_disabled: 'disabled', not_enabled: 'disabled', preview_only: 'disabled', price_changed: 'priceChanged', job_finished: 'finished',
    save_first: 'changed', quote_changed: 'changed', localType: 'localType', localSize: 'localSize', localCount: 'localCount', upload_cancelled: 'cancelled',
};
export function exportError(error: unknown, uploaded = false): string {
    if (error instanceof OfflineError) return OFFLINE_PAID_MESSAGE;
    const e = error as ApiError;
    if (e.code === 'consent_declined') return CONSENT_DECLINED_MESSAGE;
    const key = e.status === 403 && e.code === 'editor_render_media_not_owned' && uploaded ? 'uploadExpired' : ERRORS[e.code] || 'failed';
    if (e.code === 'editor_render_unsupported') return `${t('editorServerExport.unsupported')} ${exportFeature(e.body?.feature)}`;
    return t(`editorServerExport.${key}` as Parameters<typeof t>[0]);
}
export function exportFeature(feature: unknown): string {
    const key = typeof feature === 'string' ? feature : '';
    const existing: Record<string, string> = { reverse: 'editor.reverse', crop: 'editorServerExport.crop', rotation: 'editor.rotation', opacity: 'editor.opacity', transform: 'editorServerExport.transform', flipX: 'editorServerExport.flipX', flipY: 'editorServerExport.flipY', filter: 'editor.filters', picture: 'editor.animation', motion: 'editor.animation', animation: 'editor.animation', keyframes: 'editor.animation', speed: 'editor.speed', rate: 'editor.speed', speedCurve: 'editor.speed', transitionType: 'editor.transitions', multiple_tracks: 'editorServerExport.tracks', track_visibility: 'editorServerExport.visibility', overlapping_clips: 'editorServerExport.overlap', background: 'editorServerExport.background', source_aspect: 'editorServerExport.aspect', schemaVersion: 'editorServerExport.version', 'canvas.frame_rate': 'editorServerExport.frameRate', mask: 'editorServerExport.mask' };
    if (key.startsWith('text.')) return t('editor.text2');
    if (key.startsWith('media.')) return t('editor.media2');
    if (['audioProcessing', 'preservePitch', 'fadeIn', 'fadeOut', 'volume', 'audio', 'audioEffects'].includes(key)) return t('editor.audio');
    return t((existing[key] || 'editorServerExport.edit') as Parameters<typeof t>[0]);
}
