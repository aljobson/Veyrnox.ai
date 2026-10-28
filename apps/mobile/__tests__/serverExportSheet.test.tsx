import { act } from 'react';
import { Alert, AppState, Modal, Pressable, ScrollView, Text, View } from 'react-native';
import { createRoot, type Root } from 'test-renderer';
import { ServerExportSheet } from '../src/components/editor/ServerExportSheet';
import { ApiError, type ApiClient } from '../src/lib/api';
import { emptyTimeline } from '../src/lib/nativeEditorModel';
import { markOffline, markOnline, OFFLINE_PAID_MESSAGE } from '../src/lib/network';
import { shareOutput } from '../src/lib/output';
import { randomUUID } from 'expo-crypto';
import { editorDeviceMedia } from '../src/lib/editorDeviceMedia';
import * as exportUploads from '../src/lib/editorServerExportUploads';
import type { ExportRecord } from '../src/lib/editorServerExportStore';
void [Modal, Pressable, ScrollView, Text, View];
const A = '11111111-1111-4111-8111-111111111111', B = '22222222-2222-4222-8222-222222222222';
let mockRecord: ExportRecord | null = null;
let mockOwner = A;
const mockWrite = jest.fn(async (record: ExportRecord) => { mockRecord = record; });
const mockRemove = jest.fn(async () => { mockRecord = null; });
jest.mock('../src/lib/appCache', () => { const listeners: (() => void)[] = []; return { getCacheUser: () => mockOwner, reset: () => listeners.forEach(fn => fn()), subscribeCacheUser: (fn: () => void) => { listeners.push(fn); return () => { const i = listeners.indexOf(fn); if (i >= 0) listeners.splice(i, 1); }; } }; });
jest.mock('../src/lib/editorServerExportStore', () => ({ ...jest.requireActual('../src/lib/editorServerExportStore'), createExportStore: () => ({ read: async () => mockRecord, write: mockWrite, remove: mockRemove }) }));
jest.mock('../src/lib/editorDeviceMedia', () => ({ editorDeviceMedia: { files: jest.fn().mockResolvedValue({}) } }));
jest.mock('../src/lib/editorMediaDuration', () => ({ probeDuration: jest.fn() }));
jest.mock('../src/lib/output', () => ({ shareOutput: jest.fn().mockResolvedValue(undefined) }));
jest.mock('expo-crypto', () => ({ randomUUID: jest.fn(() => '22222222-2222-4222-8222-222222222222') }));
const document = { project_id: B, schema_version: 3 as const, canvas: { aspect_ratio: '16:9', frame_rate: 30 }, timeline: { ...emptyTimeline(), text: [{ id: 't1', text: 'Hello', start: 0, len: 90, x: .5, y: .85, size: 6 }] } };
let root: Root, request: jest.Mock, push: jest.Mock, close: jest.Mock, open: jest.Mock;
let props: Parameters<typeof ServerExportSheet>[0];
const visible = (text: string) => root.container.queryAll(node => node.children.includes(text)).length > 0;
async function press(label: string) {
    const button = root.container.queryAll(node => node.props.accessibilityLabel === label && typeof node.props.onClick === 'function')[0];
    expect(button).toBeDefined(); await act(async () => button.props.onClick({ nativeEvent: {}, currentTarget: 1, target: 1 }));
}
async function render() { await act(async () => root.render(<ServerExportSheet {...props} />)); }
beforeEach(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true; jest.useFakeTimers(); jest.clearAllMocks(); markOnline(); mockRecord = null; mockOwner = A;
    jest.mocked(randomUUID).mockReset().mockReturnValue(B);
    jest.mocked(editorDeviceMedia.files).mockResolvedValue({});
    require('../src/lib/appCache').reset(); Object.defineProperty(AppState, 'currentState', { configurable: true, value: 'active' });
    jest.spyOn(AppState, 'addEventListener').mockReturnValue({ remove: jest.fn() });
    root = createRoot(); push = jest.fn(); close = jest.fn(); open = jest.fn();
    request = jest.fn(async (path: string, init?: RequestInit) => {
        if (path.endsWith('/quote')) return { credits: 17, seconds: 3, resolution: JSON.parse(init!.body as string).resolution, max_seconds: 120 };
        if (path.includes('?job_id=')) return { job_id: B, state: 'running' };
        if (path.endsWith('/asset')) return { url: 'https://files.test/export', mime_type: 'video/mp4' };
        return { job_id: B, state: 'SUBMITTED' };
    });
    props = { api: { request, getBalance: jest.fn().mockResolvedValue({ balance: 33 }) } as unknown as ApiClient, router: { push }, now: () => 100, projectId: B, name: ' Project ', document, dirty: false, visible: true, onOpen: open, onClose: close, onFallback: () => push('/publish/compose') };
});
afterEach(async () => { await act(async () => root.unmount()); jest.useRealTimers(); markOnline(); jest.restoreAllMocks(); });
test.each([new ApiError(501, 'editor_server_render_disabled'), new ApiError(403, 'preview_only')])('gate refusal quietly opens compose: %s', async error => {
    request.mockRejectedValue(error); await render(); expect(push).toHaveBeenCalledWith('/publish/compose'); expect(close).toHaveBeenCalled();
    expect(visible('Server export is unavailable for this account.')).toBe(false);
});
test('confirm displays server credits and only then submits a durable immutable attempt', async () => {
    await render(); expect(visible('Export at 1080p for 17 credits?')).toBe(true);
    expect(request.mock.calls.filter(([path]) => path === '/api/v1/editor/server-render')).toHaveLength(0);
    await press('Confirm export'); const createIndex = request.mock.calls.findIndex(([path]) => path === '/api/v1/editor/server-render');
    expect(mockWrite).toHaveBeenCalled(); expect(mockWrite.mock.invocationCallOrder[0]).toBeLessThan(request.mock.invocationCallOrder[createIndex]);
    const init = request.mock.calls[createIndex][1]; expect(JSON.parse(init.body)).toMatchObject({ quoted_credits: 17, resolution: '1080p', label: 'Project' }); expect(init.headers['Idempotency-Key']).toBe(B);
});
test('402 offers credits', async () => {
    const normal = request.getMockImplementation()!;
    request.mockImplementation((path, init) => path === '/api/v1/editor/server-render' ? Promise.reject(new ApiError(402, 'insufficient_balance')) : normal(path, init));
    await render(); await press('Confirm export'); await press('Get credits'); expect(push).toHaveBeenCalledWith('/credits');
});
test('offline before prepare sends nothing, offline before confirm sends no create', async () => {
    markOffline(); await render(); expect(request).not.toHaveBeenCalled(); expect(visible(OFFLINE_PAID_MESSAGE)).toBe(true);
    markOnline(); await press('Check again'); markOffline(); await press('Confirm export');
    expect(request.mock.calls.some(([path]) => path === '/api/v1/editor/server-render')).toBe(false);
});
test('succeeded offers Share, Library and Publish with the render job', async () => {
    const normal = request.getMockImplementation()!;
    request.mockImplementation((path, init) => path.includes('?job_id=') ? Promise.resolve({ job_id: B, render_id: A, state: 'succeeded' }) : normal(path, init));
    await render(); await press('Confirm export'); expect(visible('Your export is ready')).toBe(true);
    await press('Share export'); expect(shareOutput).toHaveBeenCalledWith('https://files.test/export', A, 'video/mp4');
    await press('Open in Library'); expect(push).toHaveBeenCalledWith('/library/files');
    await press('Publish export'); expect(push).toHaveBeenCalledWith({ pathname: '/publish/compose', params: { jobId: B } }); expect(mockRemove).toHaveBeenCalled();
});
test('recovery on editor mount resumes polling without requoting', async () => {
    mockRecord = { owner: A, projectId: B, key: A, body: { document, resolution: '1080p', label: 'Old export', quoted_credits: 17 }, credits: 17, sentAt: 50, jobId: B };
    props.visible = false; await render(); expect(open).toHaveBeenCalled(); props.visible = true; await render();
    expect(request.mock.calls.some(([path]) => path.includes(`?job_id=${B}`))).toBe(true); expect(request.mock.calls.some(([path]) => path.endsWith('/quote'))).toBe(false);
});
test('an edit invalidates the quote and prevents create', async () => {
    await render(); props.document = { ...document, brief: 'Changed' }; props.dirty = true; await render();
    expect(visible('The project changed. Save it and check the export price again.')).toBe(true);
    expect(request.mock.calls.some(([path]) => path === '/api/v1/editor/server-render')).toBe(false);
});

test('mid-send recovery replays once without quoting and keeps the original key', async () => {
    mockRecord = { owner: A, projectId: B, key: A, body: { document, resolution: '720p', label: 'Original', quoted_credits: 19 }, credits: 19, sentAt: 50 };
    const original = JSON.stringify(mockRecord.body); props.visible = false; await render();
    const sends = request.mock.calls.filter(([path]) => path === '/api/v1/editor/server-render');
    expect(sends).toHaveLength(1); expect(sends[0][1]).toMatchObject({ body: original, headers: { 'Idempotency-Key': A } });
    expect(request.mock.calls.some(([path]) => path.endsWith('/quote'))).toBe(false);
});
test('polling stops after five failures and Check again resumes while Cancel remains available', async () => {
    const normal = request.getMockImplementation()!;
    request.mockImplementation((path, init) => path.includes('?job_id=') ? Promise.reject(new ApiError(503, 'unavailable')) : normal(path, init));
    await render(); await press('Confirm export'); await act(async () => jest.advanceTimersByTimeAsync(60000));
    expect(request.mock.calls.filter(([path]) => path.includes('?job_id='))).toHaveLength(5);
    expect(root.container.queryAll(node => node.props.accessibilityLabel === 'Cancel export').length).toBeGreaterThan(0);
    await press('Check again'); expect(request.mock.calls.filter(([path]) => path.includes('?job_id='))).toHaveLength(6);
});
test('polling pauses in background and resumes when active', async () => {
    let changed!: (state: 'active' | 'background') => void;
    const listener = jest.spyOn(AppState, 'addEventListener').mockImplementation((_name, fn) => { changed = fn; return { remove: jest.fn() }; });
    await render(); await press('Confirm export'); const count = request.mock.calls.filter(([path]) => path.includes('?job_id=')).length;
    await act(async () => changed('background')); await act(async () => jest.advanceTimersByTimeAsync(60000));
    expect(request.mock.calls.filter(([path]) => path.includes('?job_id='))).toHaveLength(count);
    await act(async () => changed('active')); expect(request.mock.calls.filter(([path]) => path.includes('?job_id='))).toHaveLength(count + 1); listener.mockRestore();
});

const creates = () => request.mock.calls.filter(([path]) => path === '/api/v1/editor/server-render');
const polls = () => request.mock.calls.filter(([path, init]) => path.includes('?job_id=') && init?.method !== 'DELETE');
async function confirmCancel() {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    await press('Cancel export');
    expect(alert).toHaveBeenCalledWith('Cancel export', 'Cancel this export? 17 credits will be returned.', expect.any(Array));
    await act(async () => alert.mock.calls[0][2]!.find(button => button.style === 'destructive')!.onPress!());
}
test('confirmed cancel sends DELETE and shows the returned credits', async () => {
    const normal = request.getMockImplementation()!;
    request.mockImplementation((path, init) => init?.method === 'DELETE' ? Promise.resolve({ job_id: B, state: 'REFUNDED' }) : normal(path, init));
    await render(); await press('Confirm export');
    const record = mockRecord; await confirmCancel();
    expect(request).toHaveBeenCalledWith(`/api/v1/editor/server-render?job_id=${B}`, { method: 'DELETE', headers: { 'Content-Type': 'application/json' } });
    expect(visible('The export stopped. Your credits were returned.')).toBe(true);
    expect(mockRemove).toHaveBeenCalledWith(record); expect(mockRecord).toBeNull();
    const count = polls().length; await act(async () => jest.advanceTimersByTimeAsync(60000)); expect(polls()).toHaveLength(count);
});
test('cancel losing to job_finished refreshes the completed render', async () => {
    await render(); await press('Confirm export'); const count = polls().length;
    const normal = request.getMockImplementation()!;
    request.mockImplementation((path, init) => init?.method === 'DELETE' ? Promise.reject(new ApiError(409, 'job_finished'))
        : path.includes('?job_id=') ? Promise.resolve({ job_id: B, state: 'succeeded', render_id: A }) : normal(path, init));
    await confirmCancel(); expect(polls()).toHaveLength(count + 1);
    expect(visible('Your export is ready')).toBe(true); expect(mockRecord).toBeNull();
});
test.each([new ApiError(409, 'price_changed'), new ApiError(409, 'render_refunded'), new ApiError(503, 'runner_submit_failed', { job_id: B })])('retired attempt %s is removed and a new confirmation mints a fresh key', async error => {
    jest.mocked(randomUUID).mockReturnValueOnce(B).mockReturnValueOnce(A);
    const normal = request.getMockImplementation()!;
    request.mockImplementation((path, init) => path === '/api/v1/editor/server-render' ? Promise.reject(error) : normal(path, init));
    await render(); await press('Confirm export');
    const retired = mockWrite.mock.calls[0][0];
    expect(mockRemove).toHaveBeenCalledWith(retired); expect(mockRecord).toBeNull(); expect(creates()).toHaveLength(1);
    request.mockImplementation(normal);
    await press('Check again'); expect(visible('Export at 1080p for 17 credits?')).toBe(true);
    expect(creates()).toHaveLength(1); await press('Confirm export');
    expect(creates()).toHaveLength(2);
    expect(creates().map(([, init]) => init.headers['Idempotency-Key'])).toEqual([B, A]);
    expect(randomUUID).toHaveBeenCalledTimes(2); expect(mockRecord?.key).toBe(A);
});
test.each([new ApiError(501, 'editor_server_render_disabled'), new ApiError(403, 'preview_only')])('gate refusal %s skips later probes until the account changes', async error => {
    const normal = request.getMockImplementation()!; request.mockRejectedValue(error);
    await render(); expect(push).toHaveBeenCalledTimes(1); expect(request).toHaveBeenCalledTimes(1);
    await act(async () => root.unmount()); root = createRoot();
    await render(); expect(push).toHaveBeenCalledTimes(2); expect(request).toHaveBeenCalledTimes(1);
    expect(root.container.queryAll(node => node.props.accessibilityRole === 'alert')).toHaveLength(0);
    await act(async () => { mockOwner = B; require('../src/lib/appCache').reset(); });
    await act(async () => root.unmount()); root = createRoot();
    request.mockImplementation(normal); await render();
    expect(visible('Export at 1080p for 17 credits?')).toBe(true);
    await act(async () => { mockOwner = A; require('../src/lib/appCache').reset(); });
    await act(async () => root.unmount()); root = createRoot();
    const before = request.mock.calls.length; await render(); expect(request.mock.calls.length).toBeGreaterThan(before);
    expect(visible('Export at 1080p for 17 credits?')).toBe(true);
});
test('uncertain send retains its record and Check again replays the identical attempt', async () => {
    const normal = request.getMockImplementation()!;
    request.mockImplementation((path, init) => path === '/api/v1/editor/server-render' ? Promise.reject(new ApiError(0, 'network')) : normal(path, init));
    await render(); await press('Confirm export');
    const record = mockRecord!; expect(record).not.toBeNull(); expect(mockRemove).not.toHaveBeenCalled(); expect(creates()).toHaveLength(2);
    request.mockImplementation(normal); await press('Check again'); expect(creates()).toHaveLength(3);
    for (const [, init] of creates()) expect(init).toMatchObject({ headers: { 'Idempotency-Key': record.key }, body: JSON.stringify(record.body) });
    expect(randomUUID).toHaveBeenCalledTimes(1); expect(mockRecord?.jobId).toBe(B);
});
test('failed render keeps checking until the delayed refund appears', async () => {
    const normal = request.getMockImplementation()!;
    let refunded = false;
    request.mockImplementation((path, init) => path.includes('?job_id=') ? Promise.resolve({ job_id: B, state: 'failed', refunded }) : normal(path, init));
    await render(); await press('Confirm export');
    expect(visible('The export failed. A credit refund has not been confirmed.')).toBe(true);
    refunded = true; await act(async () => jest.advanceTimersByTimeAsync(10000));
    expect(visible('The export stopped. Your credits were returned.')).toBe(true);
    const count = polls().length; await act(async () => jest.advanceTimersByTimeAsync(60000)); expect(polls()).toHaveLength(count);
});
test('refund follow-up polling is bounded and Check again can refresh it', async () => {
    const normal = request.getMockImplementation()!;
    request.mockImplementation((path, init) => path.includes('?job_id=') ? Promise.resolve({ job_id: B, state: 'failed', refunded: false }) : normal(path, init));
    await render(); await press('Confirm export'); await act(async () => jest.advanceTimersByTimeAsync(60000));
    expect(polls()).toHaveLength(6); // Initial failure plus five refund checks.
    await act(async () => jest.advanceTimersByTimeAsync(60000)); expect(polls()).toHaveLength(6);
    request.mockImplementation((path, init) => path.includes('?job_id=') ? Promise.resolve({ job_id: B, state: 'failed', refunded: true }) : normal(path, init));
    await press('Check again'); expect(polls()).toHaveLength(7);
    expect(visible('The export stopped. Your credits were returned.')).toBe(true); expect(creates()).toHaveLength(1);
});
test.each(['preparing', 'quoted', 'uploading'])('local backup metadata arriving while %s preserves the quote', async phase => {
    const id = `l-${A}`;
    props.document = { ...document, timeline: { ...document.timeline, media: { [id]: { id, kind: 'video', frames: 120 } }, video: [{ id: 'v1', mediaId: id, in: 0, len: 120 }] } };
    jest.mocked(editorDeviceMedia.files).mockResolvedValue({ [id]: { file: 'file://local', type: 'video/mp4', size: 100, seconds: 4, verified: true } });
    let finishUpload!: (mapping: Map<string, string>) => void;
    jest.spyOn(exportUploads, 'uploadExportFiles').mockImplementation(async () => phase === 'uploading' ? new Promise(resolve => { finishUpload = resolve; }) : new Map([[id, `u-${A}`]]));
    let finishQuote!: (quote: unknown) => void;
    if (phase === 'preparing') request.mockImplementationOnce(() => new Promise(resolve => { finishQuote = resolve; }));
    await render();
    if (phase === 'uploading') await press('Confirm export');
    const timeline = props.document.timeline as typeof document.timeline;
    props.document = { ...props.document, timeline: { ...timeline, media: { ...timeline.media, [id]: { ...timeline.media[id], assetSource: { projectId: B, assetId: A } } } } };
    props.dirty = true; await render();
    if (phase === 'preparing') await act(async () => finishQuote({ credits: 17, seconds: 4, resolution: '1080p', max_seconds: 120 }));
    if (phase !== 'uploading') { expect(visible('Export at 1080p for 17 credits?')).toBe(true); await press('Confirm export'); }
    else await act(async () => finishUpload(new Map([[id, `u-${A}`]])));
    expect(visible('The project changed. Save it and check the export price again.')).toBe(false);
    expect(creates()).toHaveLength(1);
    expect(JSON.parse(creates()[0][1].body).document.timeline.media[`u-${A}`].assetSource).toBeUndefined();
});
