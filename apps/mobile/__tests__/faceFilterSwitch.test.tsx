import { act } from 'react';
import * as ReactNative from 'react-native';
import { createRoot, type Root, type TestInstance } from 'test-renderer';
import * as ImagePicker from 'expo-image-picker';
import { FaceFilterResult } from '../src/components/FaceFilterResult';
import { discardCacheCopy } from '../src/lib/cacheFiles';
import { getCacheUser } from '../src/lib/appCache';
import { FaceFiltersFlow, RESULT_LINK_REFRESH_MS } from '../src/components/FaceFiltersFlow';
import { ApiError, type ApiClient } from '../src/lib/api';
import { fetchCatalog, type CatalogModel } from '../src/lib/media';
import { uploadSource } from '../src/lib/uploads';
import strings from '../src/lib/i18n/messages/en/faceFilters';
import { setLocaleFromDevice } from '../src/lib/i18n';

// RNTL is absent and installs are forbidden. Use jest-expo's installed renderer
// with real React Native controls, exercising their accessibility click handlers.
jest.mock('expo-router', () => ({ Stack: { Screen: () => null }, useRouter: () => ({ push: jest.fn() }) }));
jest.mock('expo-image', () => ({ Image: jest.requireActual('react-native').Image }));
jest.mock('expo-image-picker', () => ({ launchImageLibraryAsync: jest.fn() }));
jest.mock('expo-file-system', () => ({ File: class { exists = false; }, Paths: { cache: { uri: 'file:///cache/' } } }));
jest.mock('expo-crypto', () => ({ randomUUID: () => 'test-run-id' }));
jest.mock('../src/lib/appCache', () => {
    let user = 'owner';
    const listeners = new Set<() => void>();
    return {
        getCacheUser: () => user,
        subscribeCacheUser: (listener: () => void) => { listeners.add(listener); return () => listeners.delete(listener); },
        switchUser: (next: string) => { user = next; for (const listener of listeners) listener(); },
    };
});
jest.mock('../src/lib/cacheFiles', () => ({ discardCacheCopy: jest.fn() }));
jest.mock('../src/lib/useBalance', () => ({ useBalance: () => 100 }));
jest.mock('../src/lib/aiConsentStore', () => ({ aiConsent: { ensure: async () => {}, hasAgreed: async () => true } }));
jest.mock('../src/lib/network', () => ({ ...jest.requireActual('../src/lib/network'), ensureOnline: async () => {} }));
jest.mock('../src/lib/media', () => ({ ...jest.requireActual('../src/lib/media'), fetchCatalog: jest.fn() }));
jest.mock('../src/lib/uploads', () => ({ uploadSource: jest.fn() }));
jest.mock('../src/lib/output', () => ({ saveOutput: jest.fn(), shareOutput: jest.fn() }));

// React Native exports lazy getters. Resolve the controls during module setup,
// before the first test's interaction timeout, while retaining real native controls.
void [ReactNative.ActivityIndicator, ReactNative.Image, ReactNative.Pressable, ReactNative.ScrollView, ReactNative.StyleSheet, ReactNative.Text, ReactNative.TextInput, ReactNative.View];

const model: CatalogModel = { id: 'face-retouch', name: 'Retouch', modality: 'image-to-image', credits: 17, gated: false, durations: [], capabilities: { inputs: {}, media: { image: { required: true } } } };
const makeup: CatalogModel = { ...model, id: 'face-makeup', name: 'Makeup', credits: 23, capabilities: { inputs: { makeup_style: { type: 'enum', values: ['natural', 'bold_lips'] } }, media: { image: { required: true } } } };
const rights = strings['faceFilters.rights'];
const runLabel = 'Run filter. 17 credits per run';
let root: Root;
let send: jest.Mock;
let assetReply: jest.Mock;
let foreground: (state: ReactNative.AppStateStatus) => void;
let removeForeground: jest.Mock;
const switchUser = (next: string) => jest.requireMock('../src/lib/appCache').switchUser(next);
const applyLabel = 'Apply another filter to this result';
const sameLabel = 'Try this filter on a new photo';
const photoUri = 'file:///cache/photo.jpg';
const resultUri = 'https://example.invalid/result.jpg';
const asset = (url: string) => ({ url, mime_type: 'image/jpeg' });
function deferred<T>() {
    let resolve!: (value: T) => void;
    let reject!: (reason: unknown) => void;
    const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
    return { promise, resolve, reject };
}

beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    jest.clearAllMocks();
    switchUser('owner');
    removeForeground = jest.fn();
    jest.spyOn(ReactNative.AppState, 'addEventListener').mockImplementation((_type, listener) => {
        foreground = listener; return { remove: removeForeground };
    });
    jest.mocked(fetchCatalog).mockResolvedValue([model, makeup]);
    jest.mocked(ImagePicker.launchImageLibraryAsync).mockResolvedValue({ canceled: false, assets: [{ uri: 'file:///cache/photo.jpg', fileSize: 100, mimeType: 'image/jpeg', width: 100, height: 100 }] });
    jest.mocked(uploadSource).mockResolvedValue('uploads/photo');
    let jobs = 0;
    assetReply = jest.fn().mockResolvedValue(asset(resultUri));
    send = jest.fn(async (path: string) => {
        if (path === '/api/v1/generations') return { job_id: ++jobs === 1 ? 'job' : `job-${jobs}` };
        if (path.endsWith('/asset')) return assetReply(path);
        return { state: 'succeeded', model_id: model.id };
    });
    root = createRoot();
});
afterEach(async () => { await act(async () => root.unmount()); setLocaleFromDevice(['en']); jest.restoreAllMocks(); });

async function renderFlow() {
    await act(async () => { root.render(<FaceFiltersFlow api={{ request: send } as unknown as ApiClient} owner="owner" />); });
}
function control(role: string, label: string): TestInstance {
    const matches = root.container.queryAll(node => node.props.accessibilityRole === role && node.props.accessibilityLabel === label);
    expect(matches).toHaveLength(1);
    return matches[0];
}
async function press(role: string, label: string) {
    const node = control(role, label);
    await act(async () => { node.props.onClick({ nativeEvent: {}, currentTarget: 1, target: 1 }); });
}
async function choosePhoto() {
    await press('button', 'Retouch. Gently retouch the face in your photo.. 17 credits per run');
    expect(control('checkbox', rights).props.accessibilityState.checked).toBe(false);
    expect(control('button', runLabel).props.accessibilityState.disabled).toBe(true);
    await press('button', 'Choose one photo');
}
function previewUri() {
    const images = root.container.queryAll(node => (node.props.source?.uri || node.props.source?.[0]?.uri) && ['Before', 'After', 'Attached photo'].includes(node.props.accessibilityLabel));
    expect(images).toHaveLength(1);
    return images[0].props.source.uri ?? images[0].props.source[0].uri;
}

function matches(role: string, label: string) {
    return root.container.queryAll(node => node.props.accessibilityRole === role && node.props.accessibilityLabel === label);
}
async function chooseMakeup() { await press('button', 'Makeup. Try a makeup style on your photo.. 23 credits per run'); }
async function chooseRetouch() { await press('button', 'Retouch. Gently retouch the face in your photo.. 17 credits per run'); }
async function tickAndRun(label = runLabel) { await press('checkbox', rights); await press('button', label); }
async function chain() {
    await renderFlow(); await choosePhoto(); await tickAndRun(); await press('button', applyLabel);
}
function images() { return root.container.queryAll(node => !!(node.props.source?.uri || node.props.source?.[0]?.uri)); }
function preview() { const found = images(); expect(found).toHaveLength(1); return found[0]; }
async function imageEvent(event: 'onError' | 'onLoad') { await act(async () => { preview().props[event]({ nativeEvent: {} }); }); }
function bodies() { return send.mock.calls.filter(([path]) => path === '/api/v1/generations').map(([, init]) => JSON.parse(init.body)); }
const makeupRun = 'Run filter. 23 credits per run';

test('switch keeps the photo and resets the selected filter settings and rights', async () => {
    await renderFlow(); await chooseMakeup(); await press('button', 'Choose one photo');
    await press('radio', 'Bold lips'); await press('checkbox', rights);
    jest.mocked(discardCacheCopy).mockClear();
    await press('button', 'Change filter, current: Makeup');
    expect(preview().props.accessibilityLabel).toBe('Attached photo');
    expect(previewUri()).toBe(photoUri);
    expect(preview().props.cachePolicy).toBe('none');
    await chooseMakeup();
    expect(control('radio', 'Natural').props.accessibilityState.checked).toBe(true);
    expect(control('checkbox', rights).props.accessibilityState.checked).toBe(false);
    expect(previewUri()).toBe(photoUri);
    expect(discardCacheCopy).not.toHaveBeenCalled();
    await press('button', 'Change filter, current: Makeup'); await chooseRetouch(); await tickAndRun();
    expect(bodies()[0]).toMatchObject({ model_id: 'face-retouch', source_keys: [{ key: 'uploads/photo', slot: 'image' }] });
    expect(uploadSource).toHaveBeenCalledTimes(1);
});

test('switch also retains a previously uploaded key after a failed attempt', async () => {
    await renderFlow(); await choosePhoto();
    send.mockRejectedValueOnce(new ApiError(0, 'network'));
    await tickAndRun();
    await press('button', 'Change filter, current: Retouch'); await chooseMakeup(); await tickAndRun(makeupRun);
    expect(uploadSource).toHaveBeenCalledTimes(1);
    expect(bodies()[1]).toMatchObject({ model_id: 'face-makeup', confirmed_credits: 23, source_keys: [{ key: 'uploads/photo', slot: 'image' }] });
});

test('header replaces the old control and is disabled while the picker is busy', async () => {
    await renderFlow(); await chooseRetouch();
    expect(matches('button', 'Choose another filter')).toHaveLength(0);
    expect(control('button', 'Change filter, current: Retouch').props.accessibilityState.disabled).toBe(false);
    const pending = deferred<ImagePicker.ImagePickerResult>();
    jest.mocked(ImagePicker.launchImageLibraryAsync).mockReturnValueOnce(pending.promise);
    await press('button', 'Choose one photo');
    expect(control('button', 'Change filter, current: Retouch').props.accessibilityState.disabled).toBe(true);
    await press('button', 'Change filter, current: Retouch');
    expect(control('button', runLabel)).toBeDefined();
    await act(async () => pending.resolve({ canceled: true, assets: null }));
    expect(control('button', 'Change filter, current: Retouch').props.accessibilityState.disabled).toBe(false);
});

test('apply result refreshes its link, discards the picker copy and submits only the asset id', async () => {
    await chain();
    expect(send).toHaveBeenCalledWith('/api/v1/jobs/job/asset');
    expect(preview().props.accessibilityLabel).toBe('Attached photo');
    expect(previewUri()).toBe(resultUri);
    expect(discardCacheCopy).toHaveBeenCalledWith(photoUri);
    await chooseMakeup();
    expect(control('checkbox', rights).props.accessibilityState.checked).toBe(false);
    await tickAndRun(makeupRun);
    expect(bodies()[1]).toMatchObject({ model_id: 'face-makeup', source_assets: [{ asset_id: 'job', slot: 'image' }], consent: true });
    expect(bodies()[1].source_keys).toBeUndefined();
    expect(JSON.stringify(bodies()[1])).not.toContain(resultUri);
    expect(uploadSource).toHaveBeenCalledTimes(1);
});

test('new photo after chaining clears every trace of the result source', async () => {
    await chain(); await chooseMakeup(); await tickAndRun(makeupRun);
    const reads = assetReply.mock.calls.length;
    await press('button', sameLabel);
    expect(images()).toHaveLength(0);
    await press('checkbox', rights);
    expect(control('button', makeupRun).props.accessibilityState.disabled).toBe(true);
    await act(async () => foreground('active'));
    expect(assetReply).toHaveBeenCalledTimes(reads);
    await press('button', 'Choose one photo'); await tickAndRun(makeupRun);
    expect(bodies()[2]).toMatchObject({ source_keys: [{ key: 'uploads/photo', slot: 'image' }] });
    expect(bodies()[2].source_assets).toBeUndefined();
    expect(JSON.stringify(bodies()[2])).not.toContain(resultUri);
    expect(JSON.stringify(bodies()[2])).not.toContain('"asset_id":"job"');
    expect(uploadSource).toHaveBeenCalledTimes(2);
});

test('expired links refresh on redisplay, image error and foreground; Before refreshes the original asset', async () => {
    let now = 1000;
    jest.spyOn(Date, 'now').mockImplementation(() => now);
    await renderFlow(); await choosePhoto(); await tickAndRun();
    assetReply.mockResolvedValueOnce(asset('https://example.invalid/r1.jpg'));
    await press('button', applyLabel);
    const reads = assetReply.mock.calls.length;
    now += RESULT_LINK_REFRESH_MS + 1;
    assetReply.mockResolvedValueOnce(asset('https://example.invalid/r2.jpg'));
    await chooseMakeup();
    expect(assetReply).toHaveBeenCalledTimes(reads + 1);
    expect(previewUri()).toBe('https://example.invalid/r2.jpg');
    assetReply.mockResolvedValueOnce(asset('https://example.invalid/r3.jpg'));
    await imageEvent('onError');
    expect(assetReply).toHaveBeenCalledTimes(reads + 2);
    expect(previewUri()).toBe('https://example.invalid/r3.jpg');
    await imageEvent('onLoad');
    now += RESULT_LINK_REFRESH_MS + 1;
    assetReply.mockRejectedValueOnce(new Error('offline'));
    await act(async () => foreground('active'));
    expect(assetReply).toHaveBeenCalledTimes(reads + 3);
    expect(previewUri()).toBe('https://example.invalid/r3.jpg');
    await press('checkbox', rights);
    expect(control('button', makeupRun).props.accessibilityState.disabled).toBe(false);
    await press('button', makeupRun);
    const body = JSON.stringify(bodies()[1]);
    expect(body).toContain('"asset_id":"job"');
    for (const url of ['r1.jpg', 'r2.jpg', 'r3.jpg']) expect(body).not.toContain(url);
    await press('button', 'Before');
    assetReply.mockResolvedValueOnce(asset('https://example.invalid/before.jpg'));
    await imageEvent('onError');
    expect(assetReply).toHaveBeenLastCalledWith('/api/v1/jobs/job/asset');
    expect(previewUri()).toBe('https://example.invalid/before.jpg');
});

test.each(['pick', 'account', 'reset', 'unmount'])('deferred preview refresh cannot restore a source after %s', async action => {
    await chain(); await chooseMakeup();
    const pending = deferred<ReturnType<typeof asset>>();
    assetReply.mockReturnValueOnce(pending.promise);
    await imageEvent('onError');
    if (action === 'pick') await press('button', 'Choose one photo');
    else if (action === 'account') await act(async () => switchUser('other'));
    else if (action === 'unmount') await act(async () => root.unmount());
    else { await tickAndRun(makeupRun); await press('button', sameLabel); }
    await act(async () => pending.resolve(asset('https://example.invalid/late.jpg')));
    if (action === 'unmount') { expect(removeForeground).toHaveBeenCalled(); return; }
    if (action === 'pick') {
        expect(previewUri()).toBe(photoUri);
        await tickAndRun(makeupRun);
        expect(bodies()[1].source_assets).toBeUndefined();
    } else expect(images()).toHaveLength(0);
});

test('failed images refresh once automatically, then require Retry, until a successful load', async () => {
    let sequence = 0;
    assetReply.mockImplementation(async () => asset(`https://example.invalid/r${++sequence}.jpg`));
    await chain();
    const reads = assetReply.mock.calls.length;
    await imageEvent('onError');
    expect(assetReply).toHaveBeenCalledTimes(reads + 1);
    await imageEvent('onError'); await imageEvent('onError');
    expect(assetReply).toHaveBeenCalledTimes(reads + 1);
    expect(root.container.queryAll(node => node.children.includes('Preview unavailable'))).toHaveLength(1);
    await press('button', 'Retry');
    expect(assetReply).toHaveBeenCalledTimes(reads + 2);
    await imageEvent('onError');
    expect(assetReply).toHaveBeenCalledTimes(reads + 2);
    await imageEvent('onLoad');
    expect(matches('button', 'Retry')).toHaveLength(0);
    await imageEvent('onError');
    expect(assetReply).toHaveBeenCalledTimes(reads + 3);
});

test('Before shares the error-loop guard and manual Retry', async () => {
    await chain(); await chooseMakeup(); await tickAndRun(makeupRun); await press('button', 'Before');
    const reads = assetReply.mock.calls.length;
    await imageEvent('onError'); await imageEvent('onError');
    expect(assetReply).toHaveBeenCalledTimes(reads + 1);
    await press('button', 'Retry');
    expect(assetReply).toHaveBeenCalledTimes(reads + 2);
    await press('button', 'After');
    expect(matches('button', 'Retry')).toHaveLength(0);
    expect(preview().props.onError).toBeUndefined();
});

test('account change clears a picked photo and rights', async () => {
    await renderFlow(); await choosePhoto(); await press('checkbox', rights);
    await act(async () => switchUser('other'));
    expect(getCacheUser()).toBe('other');
    expect(images()).toHaveLength(0);
    expect(discardCacheCopy).toHaveBeenCalledWith(photoUri);
    expect(control('checkbox', rights).props.accessibilityState.checked).toBe(false);
});

test('account change closes the result and drops a late apply answer', async () => {
    await renderFlow(); await choosePhoto(); await tickAndRun();
    const pending = deferred<ReturnType<typeof asset>>();
    assetReply.mockReturnValueOnce(pending.promise);
    await press('button', applyLabel);
    expect(control('button', applyLabel).props.accessibilityState.disabled).toBe(true);
    expect(control('button', sameLabel).props.accessibilityState.disabled).toBe(true);
    await act(async () => switchUser('other'));
    for (const label of [applyLabel, sameLabel]) expect(matches('button', label)).toHaveLength(0);
    expect(images()).toHaveLength(0);
    await act(async () => pending.resolve(asset('https://example.invalid/late.jpg')));
    expect(images()).toHaveLength(0);
    for (const label of [applyLabel, sameLabel]) expect(matches('button', label)).toHaveLength(0);
});

test('standalone result drops the apply callback after an account change', async () => {
    const onApplyResult = jest.fn();
    await act(async () => root.render(<FaceFilterResult api={{ request: send } as unknown as ApiClient} owner="owner" id="job" original={photoUri} onAnother={jest.fn()} onApplyResult={onApplyResult} />));
    const pending = deferred<ReturnType<typeof asset>>();
    assetReply.mockReturnValueOnce(pending.promise);
    await press('button', applyLabel);
    await act(async () => switchUser('other'));
    await act(async () => pending.resolve(asset(resultUri)));
    expect(onApplyResult).not.toHaveBeenCalled();
});

test.each(['source_not_found', 'source_asset_invalid'])('%s clears the result source and asks for a photo', async code => {
    await chain(); await chooseMakeup();
    send.mockRejectedValueOnce(new ApiError(400, code));
    await tickAndRun(makeupRun);
    expect(images()).toHaveLength(0);
    await press('checkbox', rights);
    expect(control('button', makeupRun).props.accessibilityState.disabled).toBe(true);
    expect(root.container.queryAll(node => node.children.some(child => typeof child === 'string' && child.startsWith('The server rejected the photo:')))).toHaveLength(1);
});

test('apply rejects non-image assets; refresh keeps the previous source for a non-image reply', async () => {
    await renderFlow(); await choosePhoto(); await tickAndRun();
    assetReply.mockResolvedValueOnce({ url: 'https://example.invalid/video.mp4', mime_type: 'video/mp4' });
    await press('button', applyLabel);
    expect(control('button', applyLabel)).toBeDefined();
    expect(root.container.queryAll(node => node.children.includes('Something went wrong. Try again.'))).toHaveLength(1);
    await press('button', applyLabel); await chooseMakeup();
    assetReply.mockResolvedValueOnce({ url: 'https://example.invalid/video.mp4', mime_type: 'video/mp4' });
    await imageEvent('onError');
    expect(previewUri()).toBe(resultUri);
    await tickAndRun(makeupRun);
    expect(bodies()[1].source_assets).toEqual([{ asset_id: 'job', slot: 'image' }]);
});
