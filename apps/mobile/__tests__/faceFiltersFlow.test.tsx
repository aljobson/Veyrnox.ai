import { act } from 'react';
import * as ReactNative from 'react-native';
import { createRoot, type Root, type TestInstance } from 'test-renderer';
import * as ImagePicker from 'expo-image-picker';
import { FaceFiltersFlow } from '../src/components/FaceFiltersFlow';
import { ApiError, type ApiClient } from '../src/lib/api';
import { fetchCatalog, type CatalogModel } from '../src/lib/media';
import { uploadSource } from '../src/lib/uploads';
import strings from '../src/lib/i18n/messages/en/faceFilters';

// RNTL is absent and installs are forbidden. Use jest-expo's installed renderer
// with real React Native controls, exercising their accessibility click handlers.
jest.mock('expo-router', () => ({ Stack: { Screen: () => null }, useRouter: () => ({ push: jest.fn() }) }));
jest.mock('expo-image', () => ({ Image: jest.requireActual('react-native').Image }));
jest.mock('expo-image-picker', () => ({ launchImageLibraryAsync: jest.fn() }));
jest.mock('expo-file-system', () => ({ File: class { exists = false; }, Paths: { cache: { uri: 'file:///cache/' } } }));
jest.mock('expo-crypto', () => ({ randomUUID: () => 'test-run-id' }));
jest.mock('../src/lib/appCache', () => ({ getCacheUser: () => 'owner', subscribeCacheUser: () => () => {} }));
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
const rights = strings['faceFilters.rights'];
const runLabel = 'Run filter. 17 credits per run';
let root: Root;
let send: jest.Mock;

beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    jest.clearAllMocks();
    jest.mocked(fetchCatalog).mockResolvedValue([model]);
    jest.mocked(ImagePicker.launchImageLibraryAsync).mockResolvedValue({ canceled: false, assets: [{ uri: 'file:///cache/photo.jpg', fileSize: 100, mimeType: 'image/jpeg', width: 100, height: 100 }] });
    jest.mocked(uploadSource).mockResolvedValue('uploads/photo');
    send = jest.fn(async (path: string) => {
        if (path === '/api/v1/generations') return { job_id: 'job' };
        if (path.endsWith('/asset')) return { url: 'https://example.invalid/result.jpg', mime_type: 'image/jpeg' };
        return { state: 'succeeded', model_id: model.id };
    });
    root = createRoot();
});
afterEach(async () => { await act(async () => root.unmount()); });

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
    const images = root.container.queryAll(node => (node.props.source?.uri || node.props.source?.[0]?.uri) && ['Before', 'After'].includes(node.props.accessibilityLabel));
    expect(images).toHaveLength(1);
    return images[0].props.source.uri ?? images[0].props.source[0].uri;
}

test('renders the quiet not-open-yet state for an empty catalog', async () => {
    jest.mocked(fetchCatalog).mockResolvedValue([]);
    await renderFlow();
    expect(root.container.queryAll(node => node.children.includes('Face filters are not open yet'))).toHaveLength(1);
    expect(send).not.toHaveBeenCalled();
});

test('rights starts unticked, Run stays disabled until ticked, and an attempted run clears it', async () => {
    await renderFlow();
    await choosePhoto();
    expect(control('checkbox', rights).props.accessibilityState.checked).toBe(false);
    expect(control('button', runLabel).props.accessibilityState.disabled).toBe(true);
    await press('button', runLabel);
    expect(uploadSource).not.toHaveBeenCalled();
    await press('checkbox', rights);
    expect(control('button', runLabel).props.accessibilityState.disabled).toBe(false);
    send.mockRejectedValueOnce(new ApiError(503, 'upload_admission_unavailable'));
    await press('button', runLabel);
    expect(control('checkbox', rights).props.accessibilityState.checked).toBe(false);
    expect(control('button', runLabel).props.accessibilityState.disabled).toBe(true);
    expect(root.container.queryAll(node => node.children.includes(strings['faceFilters.uploadPaused']))).toHaveLength(1);
    expect(JSON.parse(send.mock.calls[0][1].body).consent).toBe(true);
});

test('successful run renders a working before/after toggle and Make another resets rights', async () => {
    await renderFlow();
    await choosePhoto();
    await press('checkbox', rights);
    await press('button', runLabel);
    expect(previewUri()).toBe('https://example.invalid/result.jpg');
    expect(control('button', 'After').props.accessibilityState.selected).toBe(true);
    await press('button', 'Before');
    expect(previewUri()).toBe('file:///cache/photo.jpg');
    expect(control('button', 'Before').props.accessibilityState.selected).toBe(true);
    await press('button', 'After');
    expect(previewUri()).toBe('https://example.invalid/result.jpg');
    expect(uploadSource).toHaveBeenCalledTimes(1);
    expect(control('button', 'Open in Library')).toBeDefined();
    await press('button', 'Make another');
    expect(control('checkbox', rights).props.accessibilityState.checked).toBe(false);
    expect(control('button', runLabel).props.accessibilityState.disabled).toBe(true);
});


test.each([
    ['upload_too_large', 'The server rejected the photo: the photo is over 20 MB. Nothing was charged.'],
    ['upload_new_server_reason', 'The server rejected the photo: upload_new_server_reason. Nothing was charged.'],
])('rendered upload rejection %s explains the reason before submitting', async (code, message) => {
    await renderFlow();
    await choosePhoto();
    await press('checkbox', rights);
    jest.mocked(uploadSource).mockRejectedValueOnce(new ApiError(400, code));
    await press('button', runLabel);
    expect(root.container.queryAll(node => node.children.includes(message))).toHaveLength(1);
    expect(send).not.toHaveBeenCalled();
});
