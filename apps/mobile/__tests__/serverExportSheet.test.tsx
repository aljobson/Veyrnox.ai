import { act } from 'react';
import { AppState, Modal, Pressable, ScrollView, Text, View } from 'react-native';
import { createRoot, type Root } from 'test-renderer';
import { ServerExportSheet } from '../src/components/editor/ServerExportSheet';
import { ApiError, type ApiClient } from '../src/lib/api';
import { emptyTimeline } from '../src/lib/nativeEditorModel';
import { markOffline, markOnline, OFFLINE_PAID_MESSAGE } from '../src/lib/network';
import { shareOutput } from '../src/lib/output';
import type { ExportRecord } from '../src/lib/editorServerExportStore';
void [Modal, Pressable, ScrollView, Text, View];
const A = '11111111-1111-4111-8111-111111111111', B = '22222222-2222-4222-8222-222222222222';
let mockRecord: ExportRecord | null = null;
const mockWrite = jest.fn(async (record: ExportRecord) => { mockRecord = record; });
const mockRemove = jest.fn(async () => { mockRecord = null; });
jest.mock('../src/lib/appCache', () => { const listeners: (() => void)[] = []; return { getCacheUser: () => '11111111-1111-4111-8111-111111111111', reset: () => listeners.forEach(fn => fn()), subscribeCacheUser: (fn: () => void) => { listeners.push(fn); return () => { const i = listeners.indexOf(fn); if (i >= 0) listeners.splice(i, 1); }; } }; });
jest.mock('../src/lib/editorServerExportStore', () => ({ ...jest.requireActual('../src/lib/editorServerExportStore'), createExportStore: () => ({ read: async () => mockRecord, write: mockWrite, remove: mockRemove }) }));
jest.mock('../src/lib/editorDeviceMedia', () => ({ editorDeviceMedia: { files: jest.fn().mockResolvedValue({}) } }));
jest.mock('../src/lib/editorMediaDuration', () => ({ probeDuration: jest.fn() }));
jest.mock('../src/lib/output', () => ({ shareOutput: jest.fn().mockResolvedValue(undefined) }));
jest.mock('expo-crypto', () => ({ randomUUID: () => '22222222-2222-4222-8222-222222222222' }));
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
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true; jest.useFakeTimers(); jest.clearAllMocks(); markOnline(); mockRecord = null;
    require('../src/lib/appCache').reset(); Object.defineProperty(AppState, 'currentState', { configurable: true, value: 'active' });
    root = createRoot(); push = jest.fn(); close = jest.fn(); open = jest.fn();
    request = jest.fn(async (path: string, init?: RequestInit) => {
        if (path.endsWith('/quote')) return { credits: 17, seconds: 3, resolution: JSON.parse(init!.body as string).resolution, max_seconds: 120 };
        if (path.includes('?job_id=')) return { job_id: B, state: 'running' };
        if (path.endsWith('/asset')) return { url: 'https://files.test/export', mime_type: 'video/mp4' };
        return { job_id: B, state: 'SUBMITTED' };
    });
    props = { api: { request, getBalance: jest.fn().mockResolvedValue({ balance: 33 }) } as unknown as ApiClient, router: { push }, now: () => 100, projectId: B, name: ' Project ', document, dirty: false, visible: true, onOpen: open, onClose: close, onFallback: () => push('/publish/compose') };
});
afterEach(async () => { await act(async () => root.unmount()); jest.useRealTimers(); markOnline(); });
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
