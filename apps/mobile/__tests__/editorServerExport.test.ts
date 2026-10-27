import { ApiError, type ApiClient } from '../src/lib/api';
import { exportCopy, exportDurations, exportError, exportFeature, exportSourceLink, freezeExport, renderStatus, sendExportAttempt } from '../src/lib/editorServerExport';
import { DEFAULT_TEXT_STYLE, emptyTimeline, type Timeline } from '../src/lib/nativeEditorModel';
import type { ProjectDocument } from '../src/lib/editorBridge';
import { probeDuration } from '../src/lib/editorMediaDuration';
import type { ExportRecord } from '../src/lib/editorServerExportStore';
const owner = '11111111-1111-4111-8111-111111111111', id = '22222222-2222-4222-8222-222222222222';
jest.mock('../src/lib/appCache', () => ({ getCacheUser: () => '11111111-1111-4111-8111-111111111111', subscribeCacheUser: () => () => {} }));
jest.mock('../src/lib/editorMediaDuration', () => ({ probeDuration: jest.fn() }));
const file = { file: 'file://durable', type: 'video/mp4', size: 100, seconds: 4, verified: true as const };
const fixture = (mediaId = `l-${id}`, len = 120): ProjectDocument => ({ project_id: id, schema_version: 3, canvas: { aspect_ratio: '16:9', frame_rate: 30 }, timeline: { ...emptyTimeline(), media: { [mediaId]: { id: mediaId, kind: 'video', name: 'Clip', frames: 300, assetSource: { projectId: id, assetId: owner } }, unused: { id: 'unused', kind: 'image' } }, video: [{ id: 'v1', mediaId, in: 0, len, start: 0, trackId: 'video-0', rate: 1, groupId: 'g1' }], text: [{ id: 't1', text: 'Title', x: .5, y: .85, size: 6, len: 90, start: 0, style: { ...DEFAULT_TEXT_STYLE }, groupId: 'g1' }] } });
test('phone v3 export strips only the agreed defaults, removes unused media, and never mutates saved data', () => {
    const saved = fixture(); const before = JSON.stringify(saved);
    const result = exportCopy(saved, { [`l-${id}`]: file }); const tl = result.document.timeline as Timeline;
    expect(result.blocked).toEqual([]); expect(result.uploads).toHaveLength(1);
    expect(Object.keys(tl.media)).toEqual([`l-${id}`]); expect(tl.media[`l-${id}`]).toMatchObject({ frames: 120 });
    expect(tl.media[`l-${id}`].assetSource).toBeUndefined();
    const clipKeys = ['id', 'mediaId', 'in', 'len', 'volume', 'transition', 'start', 'trackId', 'transitionType'];
    const textKeys = ['id', 'text', 'start', 'len', 'x', 'y', 'size', 'trackId'];
    expect(Object.keys(tl.video[0]).every(k => clipKeys.includes(k))).toBe(true);
    expect(Object.keys(tl.text[0]).every(k => textKeys.includes(k))).toBe(true);
    expect(JSON.stringify(saved)).toBe(before);
    (saved.timeline as Timeline).video[0].rate = 2; (saved.timeline as Timeline).text[0].style!.color = 'red';
    const changed = exportCopy(saved, { [`l-${id}`]: file }).document.timeline as Timeline;
    expect(changed.video[0].rate).toBe(2); expect(changed.text[0].style?.color).toBe('red');
});
test.each([['p-', 'notOnPhone'], ['l-', 'notOnPhone'], ['j-', 'durationUnknown'], ['j-', 'unsupported', '--vocals']])('blocks %s: %s', (prefix, reason, suffix = '') => {
    expect(exportCopy(fixture(`${prefix}${id}${suffix}`), {}).blocked[0].reason).toBe(reason);
});
test.each([4, 20])('Files import with %s seconds uses the real frames before quote', async seconds => {
    (probeDuration as jest.Mock).mockResolvedValue(seconds);
    const saved = fixture(`l-${id}`, seconds * 30), files = { [`l-${id}`]: { ...file, verified: undefined, seconds: undefined } };
    const durations = await exportDurations({} as ApiClient, saved, files);
    const result = exportCopy(saved, files, durations);
    expect((result.document.timeline as Timeline).media[`l-${id}`].frames).toBe(seconds * 30); expect(result.blocked).toEqual([]);
});
test('blocks an overlong clip and unverified source', () => {
    expect(exportCopy(fixture(`l-${id}`, 121), { [`l-${id}`]: file }).blocked[0].reason).toBe('clipLongerThanFile');
    expect(exportCopy(fixture(), { [`l-${id}`]: { ...file, verified: undefined } }).blocked[0].reason).toBe('durationUnknown');
});
test.each([['j', 'audio', 'audio/mpeg', '/jobs/'], ['j', 'video', 'video/mp4', '/jobs/'], ['e', 'video', 'video/mp4', '/editor-renders/'], ['f', 'video', 'video/mp4', '/masters/']])('resolves %s %s source links', async (prefix, kind, mime, path) => {
    const request = jest.fn().mockResolvedValue({ url: 'https://files.test/source', mime_type: mime });
    expect(await exportSourceLink({ request } as unknown as ApiClient, { id: `${prefix}-${id}`, kind })).toBe('https://files.test/source'); expect(request.mock.calls[0][0]).toContain(path);
});
test('rejects mismatched MIME, insecure links, and stems without a request', async () => {
    const request = jest.fn().mockResolvedValue({ url: 'https://files.test/source', mime_type: 'video/mp4' }); const api = { request } as unknown as ApiClient;
    expect(await exportSourceLink(api, { id: `j-${id}`, kind: 'audio' })).toBeNull();
    request.mockResolvedValue({ url: 'http://files.test/source', mime_type: 'video/mp4' });
    expect(await exportSourceLink(api, { id: `j-${id}`, kind: 'video' })).toBeNull(); request.mockClear();
    expect(await exportSourceLink(api, { id: `j-${id}--vocals`, kind: 'audio' })).toBeNull(); expect(request).not.toHaveBeenCalled();
});
test('error, feature and public status mappings never expose server codes', () => {
    expect(exportError(new ApiError(400, 'editor_render_duration_limit'))).toContain('duration');
    expect(exportError(new ApiError(400, 'editor_render_clip_limit'))).toContain('clips');
    expect(exportError(new ApiError(403, 'editor_render_media_not_owned'), true)).toContain('expired');
    expect(exportFeature('text.style')).toBe('Text'); expect(exportFeature('rate')).toBe('Speed'); expect(exportFeature('untrusted')).toBe('Timeline edit');
    expect(renderStatus({ job_id: id, state: 'succeeded', render_id: owner }).phase).toBe('done');
    expect(renderStatus({ job_id: id, state: 'failed', refunded: true })).toMatchObject({ phase: 'failed', refunded: true });
    expect(renderStatus({ job_id: id, state: 'REFUNDED' }).refunded).toBe(true);
});
test('a transport retry sends an identical immutable key and body only once', async () => {
    const attempt: ExportRecord = freezeExport({ owner, projectId: id, key: id, credits: 7, sentAt: 0, body: { document: fixture(), resolution: '1080p', label: 'Export', quoted_credits: 7 } });
    const request = jest.fn().mockRejectedValueOnce(new ApiError(503, 'gateway')).mockResolvedValue({ job_id: id, state: 'SUBMITTED' });
    await sendExportAttempt({ request } as unknown as ApiClient, attempt);
    expect(request).toHaveBeenCalledTimes(2); expect(request.mock.calls[0]).toEqual(request.mock.calls[1]); expect(Object.isFrozen(attempt.body.document)).toBe(true);
    request.mockReset().mockRejectedValue(new ApiError(503, 'runner_submit_failed', { job_id: id }));
    await expect(sendExportAttempt({ request } as unknown as ApiClient, attempt)).rejects.toMatchObject({ status: 503 }); expect(request).toHaveBeenCalledTimes(1);
});
