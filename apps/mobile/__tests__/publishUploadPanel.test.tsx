import { act } from 'react';
import * as RN from 'react-native';
import { createRoot, type Root, type TestInstance } from 'test-renderer';
import * as ImagePicker from 'expo-image-picker';
import * as DocumentPicker from 'expo-document-picker';
import { PublishUploadPanel } from '../src/components/PublishUploadPanel';
import { ApiError, type ApiClient } from '../src/lib/api';
import { putFromDisk } from '../src/lib/uploads';
import strings from '../src/lib/i18n/messages/en/publishUploads';

let mockOwner = 'A'; const mockListeners = new Set<() => void>(); const mockDeleted = jest.fn();
const mockSave = jest.fn();
jest.mock('../src/lib/appCache', () => ({ getCacheUser: () => mockOwner, subscribeCacheUser: (fn: () => void) => { mockListeners.add(fn); return () => mockListeners.delete(fn); } }));
jest.mock('expo-file-system', () => ({ File: class { exists = true; size = 200; uri: string; constructor(uri: string) { this.uri = uri; } delete() { mockDeleted(this.uri); } }, Paths: { cache: { uri: 'file:///cache/' } } }));
jest.mock('../src/lib/chatResizer', () => ({ loadManipulator: () => ({ ImageManipulator: { manipulate: () => ({ renderAsync: async () => ({ saveAsync: mockSave }) }) }, SaveFormat: { JPEG: 'jpeg' } }) }));
jest.mock('expo-image', () => ({ Image: (props: object) => require('react').createElement(require('react-native').View, { ...props, testID: 'upload-preview' }) }));
jest.mock('expo-image-picker', () => ({ launchImageLibraryAsync: jest.fn(), launchCameraAsync: jest.fn(), requestCameraPermissionsAsync: jest.fn() }));
jest.mock('expo-document-picker', () => ({ getDocumentAsync: jest.fn() }));
jest.mock('../src/lib/uploads', () => ({ putFromDisk: jest.fn() }));
void [RN.Pressable, RN.Text, RN.View, RN.StyleSheet];
let root: Root, request: jest.Mock, onSelect: jest.Mock, onBusyChange: jest.Mock;
const grant = { id: 'u', upload_url: 'https://a.r2.cloudflarestorage.com/u', content_type: 'image/jpeg', headers: { 'If-None-Match': '*' } };
const row = { id: 'u', mime_type: 'image/jpeg', size_bytes: 200, url: 'https://preview.test/u', filename: 'private name' };
const picked = (mimeType = 'image/jpeg') => ({ canceled: false as const, assets: [{ uri: 'file:///cache/pick', mimeType, width: 100, height: 100 }] });
function deferred<T>() { let resolve!: (v: T) => void; const promise = new Promise<T>(r => { resolve = r; }); return { promise, resolve }; }
const bodyCalls = () => request.mock.calls.map(([, init]) => ({ method: init?.method || 'GET', ...JSON.parse(init?.body || '{}') }));
beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    jest.clearAllMocks(); mockOwner = 'A'; mockListeners.clear(); root = createRoot(); onSelect = jest.fn(); onBusyChange = jest.fn();
    jest.mocked(ImagePicker.launchImageLibraryAsync).mockResolvedValue(picked());
    jest.mocked(putFromDisk).mockResolvedValue(); mockSave.mockResolvedValue({ uri: 'file:///cache/converted', width: 100, height: 100 });
    request = jest.fn(async (_path: string, init?: RequestInit) => {
        const b = JSON.parse(String(init?.body || '{}'));
        return b.action === 'reserve' ? grant : b.action === 'complete' ? { upload: row } : { uploads: [] };
    });
});
afterEach(async () => { await act(async () => root.unmount()); });
async function render(enabled = true, selectedUploadId: string | null = null, max = 1, nonUploadCount = 0) {
    await act(async () => root.render(<PublishUploadPanel api={{ request } as unknown as ApiClient} enabled={enabled} max={max} nonUploadCount={nonUploadCount} selectedUploads={selectedUploadId ? [{ uploadId: selectedUploadId, mediaType: 'image' }] : []} onSelect={onSelect} onBusyChange={onBusyChange} />));
}
const nodes = (role: string) => root.container.queryAll(n => n.props.accessibilityRole === role);
function control(key: keyof typeof strings, role = 'button'): TestInstance {
    const found = root.container.queryAll(n => n.props.accessibilityRole === role && (n.props.accessibilityLabel === strings[key] ||
        (['publishUploads.select', 'publishUploads.remove'].includes(key) && n.props.accessibilityLabel?.startsWith(`${strings[key]} `))));
    expect(found).toHaveLength(1); return found[0];
}
async function press(key: keyof typeof strings, role = 'button') {
    await act(async () => { control(key, role).props.onClick({ nativeEvent: {}, currentTarget: 1, target: 1 }); });
}
async function pick() { await press('publishUploads.rights', 'checkbox'); await press('publishUploads.library'); }
const text = () => root.container.queryAll(n => n.children.some(c => typeof c === 'string')).flatMap(n => n.children.filter(c => typeof c === 'string')).join(' ');
async function switchAccount() { await act(async () => { mockOwner = 'B'; mockListeners.forEach(fn => fn()); }); }

test('Photos preserves multiple picker items in order and cleans every cached copy', async () => {
    jest.mocked(ImagePicker.launchImageLibraryAsync).mockResolvedValue({ canceled: false, assets: [
        { uri: 'file:///cache/one', mimeType: 'image/jpeg', width: 100, height: 100 },
        { uri: 'file:///cache/two', mimeType: 'image/jpeg', width: 100, height: 100 },
    ] });
    let sequence = 0;
    request.mockImplementation(async (_path: string, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body || '{}'));
        return body.action === 'reserve' ? { ...grant, id: `u${++sequence}` } : body.action === 'complete' ? { upload: { ...row, id: `u${sequence}` } } : { uploads: [] };
    });
    await render(true, null, 4); await pick();
    expect(ImagePicker.launchImageLibraryAsync).toHaveBeenCalledWith(expect.objectContaining({ allowsMultipleSelection: true, orderedSelection: true, selectionLimit: 4 }));
    expect(onSelect).toHaveBeenLastCalledWith([{ uploadId: 'u1', mediaType: 'image' }, { uploadId: 'u2', mediaType: 'image' }]);
    expect(mockDeleted).toHaveBeenCalledWith('file:///cache/one'); expect(mockDeleted).toHaveBeenCalledWith('file:///cache/two');
});

test('account change while a multiple Files picker is open discards every late copy', async () => {
    const held = deferred<Awaited<ReturnType<typeof DocumentPicker.getDocumentAsync>>>();
    jest.mocked(DocumentPicker.getDocumentAsync).mockReturnValueOnce(held.promise);
    await render(true, null, 4); await press('publishUploads.rights', 'checkbox'); await press('publishUploads.files');
    expect(DocumentPicker.getDocumentAsync).toHaveBeenCalledWith(expect.objectContaining({ multiple: true, copyToCacheDirectory: true }));
    await switchAccount();
    await act(async () => held.resolve({ canceled: false, assets: [
        { uri: 'file:///cache/one', name: 'one.jpg', mimeType: 'image/jpeg', lastModified: 0 },
        { uri: 'file:///cache/two', name: 'two.jpg', mimeType: 'image/jpeg', lastModified: 0 },
    ] }));
    expect(bodyCalls().some(c => c.action === 'reserve')).toBe(false);
    expect(mockDeleted).toHaveBeenCalledWith('file:///cache/one'); expect(mockDeleted).toHaveBeenCalledWith('file:///cache/two');
    expect(onSelect.mock.calls.filter(([p]) => p.length > 0)).toHaveLength(0);
});

test('false gate renders nothing and sends nothing', async () => { await render(false); expect(nodes('header')).toHaveLength(0); expect(request).not.toHaveBeenCalled(); });
test('unticked rights disables pickers; all buttons labeled and heading is header', async () => {
    await render(); expect(nodes('header')).toHaveLength(1);
    expect(control('publishUploads.rights', 'checkbox').props.accessibilityState).toEqual({ checked: false, disabled: false });
    for (const key of ['library', 'files', 'camera'] as const) expect(control(`publishUploads.${key}`).props.accessibilityState.disabled).toBe(true);
    nodes('button').forEach(n => expect(n.props.accessibilityLabel).toBeTruthy());
});
test('success selects ready upload, clears rights, cleans copies and disables image disk cache', async () => {
    await render(); await pick();
    expect(onSelect).toHaveBeenCalledWith([{ uploadId: 'u', mediaType: 'image' }]);
    expect(control('publishUploads.rights', 'checkbox').props.accessibilityState.checked).toBe(false);
    expect(mockDeleted).toHaveBeenCalledWith('file:///cache/pick');
    expect(text()).toContain(strings['publishUploads.selectedNotice']); expect(text()).not.toContain('private name');
    expect(nodes('status')[0].props.accessibilityLiveRegion).toBe('polite');
    const images = root.container.queryAll(n => n.props.testID === 'upload-preview'); expect(images).toHaveLength(1);
    images.forEach(n => { expect(n.props.cachePolicy).toBe('none'); expect(n.props.transition).toBe(0); });
});
test('list uploads_not_open hides quietly', async () => {
    request.mockRejectedValueOnce(new ApiError(503, 'uploads_not_open')); await render();
    expect(nodes('header')).toHaveLength(0); expect(text()).not.toContain('uploads_not_open'); expect(onSelect).toHaveBeenCalledWith([]);
});
test('list failure offers Retry', async () => {
    request.mockRejectedValueOnce(new ApiError(503, 'uploads_unavailable')); await render(); expect(text()).toContain(strings['publishUploads.loadFailed']);
    expect(nodes('alert')[0].props.accessibilityLiveRegion).toBe('polite');
    await press('publishUploads.retry'); expect(request).toHaveBeenCalledTimes(2);
});
test('Cancel mid-upload shows canceled, clears progress and busy without selection', async () => {
    jest.mocked(putFromDisk).mockImplementationOnce(async (_url, _headers, _uri, progress, signal) => {
        progress(0.5); await new Promise<void>((_resolve, reject) => signal.addEventListener('abort', () => reject(Object.assign(new Error(), { name: 'AbortError' }))));
    });
    await render(); await pick(); expect(nodes('progressbar')).toHaveLength(1);
    expect(control('publishUploads.cancel').props.accessibilityLabel).toBe('Cancel upload');
    await press('publishUploads.cancel');
    expect(nodes('status')[0].props.accessibilityLiveRegion).toBe('polite');
    expect(nodes('alert')).toHaveLength(0);
    expect(text()).toContain('Upload canceled.'); expect(text()).toContain(strings['publishUploads.removed']); expect(nodes('progressbar')).toHaveLength(0);
    expect(onBusyChange).toHaveBeenLastCalledWith(false); expect(onSelect).not.toHaveBeenCalled();
    expect(bodyCalls().filter(c => c.method === 'DELETE')).toEqual([{ method: 'DELETE', id: 'u' }]);
});
test('account change while picker is deferred discards late file and never reserves', async () => {
    const held = deferred<ReturnType<typeof picked>>(); jest.mocked(ImagePicker.launchImageLibraryAsync).mockReturnValueOnce(held.promise);
    await render(); await pick(); await switchAccount();
    await act(async () => held.resolve(picked()));
    expect(bodyCalls().some(c => c.action === 'reserve')).toBe(false); expect(mockDeleted).toHaveBeenCalledWith('file:///cache/pick');
    expect(onSelect.mock.calls.filter(([p]) => p.length > 0)).toHaveLength(0);
});
test('account change during HEIC conversion deletes late converted copy', async () => {
    const held = deferred<{ uri: string; width: number; height: number }>(); mockSave.mockReturnValueOnce(held.promise);
    jest.mocked(ImagePicker.launchImageLibraryAsync).mockResolvedValueOnce(picked('image/heic'));
    await render(); await pick(); await switchAccount(); await act(async () => held.resolve({ uri: 'file:///cache/converted', width: 100, height: 100 }));
    expect(bodyCalls().some(c => c.action === 'reserve')).toBe(false); expect(mockDeleted).toHaveBeenCalledWith('file:///cache/converted');
});
test('account change during list keeps it empty', async () => {
    const held = deferred<{ uploads: typeof row[] }>(); request.mockReturnValueOnce(held.promise);
    await render(); await switchAccount(); await act(async () => held.resolve({ uploads: [row] }));
    expect(root.container.queryAll(n => n.props.accessibilityRole === 'button' && n.props.accessibilityLabel?.startsWith('Select '))).toHaveLength(0);
});
test('account switch during reserve makes no PUT, complete or DELETE', async () => {
    const held = deferred<typeof grant>(); await render(); request.mockReturnValueOnce(held.promise);
    await pick(); await switchAccount(); await act(async () => held.resolve(grant));
    expect(putFromDisk).not.toHaveBeenCalled(); expect(bodyCalls().some(c => c.action === 'complete' || c.method === 'DELETE')).toBe(false);
    expect(onSelect.mock.calls.filter(([p]) => p.length > 0)).toHaveLength(0);
});
test('same-account unmount during reserve deletes exactly once without late callbacks or warnings', async () => {
    const held = deferred<typeof grant>(); await render(); request.mockReturnValueOnce(held.promise); await pick();
    const errors = jest.spyOn(console, 'error').mockImplementation(() => {});
    await act(async () => root.unmount()); onSelect.mockClear(); onBusyChange.mockClear();
    await act(async () => held.resolve(grant));
    expect(bodyCalls().filter(c => c.method === 'DELETE')).toEqual([{ method: 'DELETE', id: 'u' }]);
    expect(onSelect).not.toHaveBeenCalled(); expect(onBusyChange).not.toHaveBeenCalled(); expect(errors).not.toHaveBeenCalled(); errors.mockRestore();
});
test('remove selected clears parent; removing unselected does not', async () => {
    request.mockResolvedValueOnce({ uploads: [row] }); await render(true, 'other'); await press('publishUploads.remove'); expect(onSelect).not.toHaveBeenCalled();
    await act(async () => root.unmount()); root = createRoot(); request.mockResolvedValueOnce({ uploads: [row] }); await render(true, 'u');
    expect(control('publishUploads.select').props.accessibilityState.selected).toBe(true);
    await press('publishUploads.remove'); expect(onSelect).toHaveBeenCalledWith([]);
});
test('Files and camera use the specified pickers; no microphone', async () => {
    jest.mocked(DocumentPicker.getDocumentAsync).mockResolvedValueOnce({ canceled: true, assets: null });
    await render(); await press('publishUploads.rights', 'checkbox'); await press('publishUploads.files');
    expect(DocumentPicker.getDocumentAsync).toHaveBeenCalledWith({ type: ['image/jpeg', 'image/png', 'image/webp', 'video/mp4'], copyToCacheDirectory: true, multiple: false });
    jest.mocked(ImagePicker.requestCameraPermissionsAsync).mockResolvedValueOnce({ granted: true } as ImagePicker.CameraPermissionResponse);
    jest.mocked(ImagePicker.launchCameraAsync).mockResolvedValueOnce(picked());
    await press('publishUploads.rights', 'checkbox'); await press('publishUploads.camera');
    expect(ImagePicker.launchCameraAsync).toHaveBeenCalledWith(expect.objectContaining({ mediaTypes: ['images'] }));
});

test('account change aborts native PUT, cleans temporary file and sends no DELETE', async () => {
    let signal: AbortSignal | undefined;
    jest.mocked(putFromDisk).mockImplementationOnce(async (_url, _headers, _uri, _progress, incoming) => {
        signal = incoming;
        await new Promise<void>((_resolve, reject) => incoming.addEventListener('abort', () => reject(new Error('aborted'))));
    });
    await render(); await pick(); await switchAccount();
    expect(signal?.aborted).toBe(true); expect(mockDeleted).toHaveBeenCalledWith('file:///cache/pick');
    expect(bodyCalls().some(c => c.method === 'DELETE' || c.action === 'complete')).toBe(false);
    expect(onSelect.mock.calls.filter(([p]) => p.length > 0)).toHaveLength(0);
});
test('remove in-use shows web wording and keeps the selected row', async () => {
    request.mockResolvedValueOnce({ uploads: [row] }); await render(true, 'u');
    request.mockRejectedValueOnce(new ApiError(409, 'upload_in_use')); await press('publishUploads.remove');
    expect(text()).toContain(strings['publishUploads.error.upload_in_use']); expect(onSelect).not.toHaveBeenCalled();
    expect(nodes('alert')[0].props.accessibilityLiveRegion).toBe('polite');
    expect(control('publishUploads.select').props.accessibilityState.selected).toBe(true);
});
test('same-account cancel during deferred reserve gives cancellation copy and one DELETE', async () => {
    const held = deferred<typeof grant>(); await render(); request.mockReturnValueOnce(held.promise); await pick();
    await press('publishUploads.cancel'); await act(async () => held.resolve(grant));
    expect(text()).toContain(strings['publishUploads.canceled']); expect(onSelect).not.toHaveBeenCalled();
    expect(putFromDisk).not.toHaveBeenCalled(); expect(bodyCalls().filter(c => c.method === 'DELETE')).toHaveLength(1);
});


test('row buttons announce type and size without filenames', async () => {
    request.mockResolvedValueOnce({ uploads: [
        { ...row, size_bytes: Math.round(1.2 * 1048576) },
        { ...row, id: 'video', mime_type: 'video/mp4', size_bytes: 90 * 1048576 },
    ] });
    await render();
    const labels = nodes('button').map(n => n.props.accessibilityLabel);
    expect(labels).toEqual(expect.arrayContaining(['Remove image, 1.2 MB', 'Select image, 1.2 MB', 'Remove video, 90.0 MB', 'Select video, 90.0 MB']));
    expect(labels.every(label => !label.includes('private name'))).toBe(true);
});
test('native file failures are announced as generic errors rather than offline', async () => {
    jest.mocked(putFromDisk).mockRejectedValueOnce(new ApiError(0, 'upload_failed'));
    await render(); await pick();
    expect(text()).toContain(strings['publishUploads.failed']);
    expect(text()).not.toContain(strings['publishUploads.offline']);
    expect(nodes('alert')[0].props.accessibilityLiveRegion).toBe('polite');
});
test('account changes reopen and reload a per-user gate, respecting the current enabled prop', async () => {
    request.mockImplementation(async () => {
        if (mockOwner === 'A') throw new ApiError(503, 'uploads_not_open');
        return { uploads: [{ ...row, id: 'b-upload', mime_type: 'video/mp4', size_bytes: 1048576 }] };
    });
    // Start disabled to catch a listener that captures its mount-time enabled flag.
    await render(false); expect(request).not.toHaveBeenCalled();
    await render(true); expect(nodes('header')).toHaveLength(0); expect(request).toHaveBeenCalledTimes(1);
    await switchAccount();
    expect(nodes('header')).toHaveLength(1); expect(request).toHaveBeenCalledTimes(2);
    const selected = root.container.queryAll(n => n.props.accessibilityRole === 'button' && n.props.accessibilityLabel === 'Select video, 1.0 MB');
    expect(selected).toHaveLength(1);
    await act(async () => selected[0].props.onClick({ nativeEvent: {}, currentTarget: 1, target: 1 }));
    expect(onSelect).toHaveBeenLastCalledWith([{ uploadId: 'b-upload', mediaType: 'video' }]);
    await act(async () => { mockOwner = 'A'; mockListeners.forEach(fn => fn()); });
    expect(nodes('header')).toHaveLength(0); expect(onSelect).toHaveBeenLastCalledWith([]);
    await render(false); await switchAccount(); expect(request).toHaveBeenCalledTimes(3);
    await render(true); expect(nodes('header')).toHaveLength(1); expect(request).toHaveBeenCalledTimes(4);
});

for (const [max, jobs, selected] of [[3, 2, 'u'], [0, 0, null]] as const) test(`full carousel or zero capacity (${max}, ${jobs} jobs) blocks additions and preserves uploads`, async () => {
    request.mockResolvedValueOnce({ uploads: [{ ...row, id: 'another' }] });
    await render(true, selected, max, jobs);
    await press('publishUploads.rights', 'checkbox');
    for (const key of ['library', 'files', 'camera'] as const) {
        expect(control(`publishUploads.${key}`).props.accessibilityState.disabled).toBe(true);
        await press(`publishUploads.${key}`);
    }
    expect(control('publishUploads.select').props.accessibilityState.disabled).toBe(true);
    await press('publishUploads.select');
    expect(onSelect).not.toHaveBeenCalled();
    expect(ImagePicker.launchImageLibraryAsync).not.toHaveBeenCalled();
    expect(DocumentPicker.getDocumentAsync).not.toHaveBeenCalled();
    expect(ImagePicker.launchCameraAsync).not.toHaveBeenCalled();
    expect(text()).not.toMatch(/Maximum -/);
});
test('one remaining place in a carousel still uses multiple selection with capacity one', async () => {
    await render(true, null, 3, 2); await pick();
    expect(ImagePicker.launchImageLibraryAsync).toHaveBeenCalledWith(expect.objectContaining({ allowsMultipleSelection: true, selectionLimit: 1 }));
    expect(onSelect).toHaveBeenLastCalledWith([{ uploadId: 'u', mediaType: 'image' }]);
});

for (const [selected, jobs] of [['previous', 0], [null, 1]] as const) {
    for (const source of ['library', 'files', 'camera'] as const) test(`single-file ${source} replaces ${selected ? 'upload' : 'job'} choice`, async () => {
        jest.mocked(DocumentPicker.getDocumentAsync).mockResolvedValueOnce({ canceled: false, assets: [{ uri: 'file:///cache/pick', name: 'replacement.jpg', mimeType: 'image/jpeg', lastModified: 0 }] });
        jest.mocked(ImagePicker.requestCameraPermissionsAsync).mockResolvedValueOnce({ granted: true } as ImagePicker.CameraPermissionResponse);
        jest.mocked(ImagePicker.launchCameraAsync).mockResolvedValueOnce(picked());
        await render(true, selected, 1, jobs);
        await press('publishUploads.rights', 'checkbox');
        expect(control(`publishUploads.${source}`).props.accessibilityState.disabled).toBe(false);
        await press(`publishUploads.${source}`);
        expect(onSelect).toHaveBeenCalledTimes(1);
        expect(onSelect).toHaveBeenCalledWith([{ uploadId: 'u', mediaType: 'image' }]);
        expect(mockDeleted).toHaveBeenCalledWith('file:///cache/pick');
        if (source === 'library') expect(ImagePicker.launchImageLibraryAsync).toHaveBeenCalledWith(expect.objectContaining({ allowsMultipleSelection: false, selectionLimit: 1 }));
        if (source === 'files') expect(DocumentPicker.getDocumentAsync).toHaveBeenCalledWith(expect.objectContaining({ multiple: false }));
    });
    test(`single-file row Select replaces ${selected ? 'upload' : 'job'} choice`, async () => {
        request.mockResolvedValueOnce({ uploads: [row] });
        await render(true, selected, 1, jobs);
        expect(control('publishUploads.select').props.accessibilityState.disabled).toBe(false);
        await press('publishUploads.select');
        expect(onSelect).toHaveBeenCalledWith([{ uploadId: 'u', mediaType: 'image' }]);
    });
}
test('canceling or failing a single-file replacement preserves the previous upload', async () => {
    await render(true, 'previous', 1);
    jest.mocked(ImagePicker.launchImageLibraryAsync).mockResolvedValueOnce({ canceled: true, assets: null });
    await pick(); expect(onSelect).not.toHaveBeenCalled();
    jest.mocked(putFromDisk).mockRejectedValueOnce(new ApiError(0, 'upload_failed'));
    await pick(); expect(onSelect).not.toHaveBeenCalled();
});
