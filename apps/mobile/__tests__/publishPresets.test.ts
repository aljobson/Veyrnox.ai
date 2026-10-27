import { act, createElement } from 'react';
import * as RN from 'react-native';
import { createRoot, type Root } from 'test-renderer';
import { ApiError, type ApiClient } from '../src/lib/api';
import { applyPreset, deletePreset, fetchPresets, parsePresets, presetDraftProblem, presetErrorKey, savePreset } from '../src/lib/publishPresets';
import { ComposePresets } from '../src/components/publish/ComposePresets';
import Compose from '../src/app/(app)/publish/compose';
import { brandStore } from '../src/lib/publishBrand';
import { createBody } from '../src/lib/publishCompose';
import { t } from '../src/lib/i18n';
import { ID, OTHER, buttons, deferred, field, input, press, textOf } from './publishDepthTestHelpers';
const mockRequest = jest.fn(), mockApi = { request: mockRequest } as unknown as ApiClient;
var mockListeners = new Set<() => void>();
let mockUser = 'owner';
jest.mock('../src/lib/usePublishApi', () => ({ usePublishApi: () => mockApi }));
jest.mock('expo-router', () => ({ Stack: { Screen: () => null }, useLocalSearchParams: () => ({}), useRouter: () => ({ replace: jest.fn() }) }));
jest.mock('expo-crypto', () => ({ randomUUID: () => 'test-idempotency-key' }));
jest.mock('../src/lib/appCache', () => ({ getCacheUser: () => mockUser, subscribeCacheUser: (fn: () => void) => { (mockListeners ??= new Set()).add(fn); return () => mockListeners.delete(fn); }, appStorage: { get: async () => null, set: async () => {}, remove: async () => {} } }));
jest.mock('../src/lib/media', () => ({ ...jest.requireActual('../src/lib/media'), fetchCatalog: async () => [{ id: 'image', name: 'Image', modality: 'text-to-image' }], mediaApi: () => ({ listJobs: async () => ({ jobs: [{ job_id: 'j', model_id: 'image', label: 'Creation', state: 'succeeded', has_asset: true, created_at: '2026-10-21' }] }) }) }));
jest.mock('../src/components/PublishUploadPanel', () => ({ PublishUploadPanel: () => null }));
void [RN.Pressable, RN.TextInput, RN.Text, RN.View, RN.ScrollView, RN.StyleSheet, RN.ActivityIndicator, RN.KeyboardAvoidingView];
const raw = { id: ID, name: 'Launch', caption: 'Brand A caption', account_ids: [ID, OTHER] };
const preset = { id: ID, name: raw.name, caption: raw.caption, accountIds: [ID, OTHER] };
let root: Root, alert: jest.SpyInstance;
const applied = jest.fn();
const props = () => ({ api: mockApi, text: 'Typed caption', networkText: {}, mode: 'now', selected: [{ id: OTHER }], eligible: [{ id: ID }], onApply: applied });
beforeEach(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true; brandStore.set(null); mockUser = 'owner'; jest.clearAllMocks(); root = createRoot();
    alert = jest.spyOn(RN.Alert, 'alert').mockImplementation(() => {});
    mockRequest.mockImplementation(async (url: string) => {
        if (url.endsWith('/presets')) return { presets: [raw] };
        if (url.endsWith('/accounts')) return { contentPresetsEnabled: true, brandRole: 'owner', accounts: [{ id: ID, network: 'instagram', display_name: 'Studio', status: 'active', publishingEnabled: true, supportedMedia: ['image'] }] };
        if (url.endsWith('/queues')) return { queues: [{ id: OTHER, name: 'Queue', enabled: true, account_ids: [ID], slots: [] }] };
        return {};
    });
});
afterEach(async () => { await act(async () => root.unmount()); alert.mockRestore(); brandStore.set(null); });
const render = async (overrides = {}) => { await act(async () => root.render(createElement(ComposePresets, { ...props(), ...overrides }))); };
const confirm = async () => { const action = alert.mock.calls.at(-1)?.[2].find((b: { onPress?: () => void }) => b.onPress); expect(action).toBeDefined(); await act(async () => { action.onPress(); }); };

test('parse validates UUIDs, bounds text and intersects eligible accounts', async () => {
    expect(parsePresets({ presets: [{ ...raw, name: 'x'.repeat(100), account_ids: [ID, 'bad', ID] }, { ...raw, id: 'bad' }] })).toEqual([{ ...preset, name: 'x'.repeat(80), accountIds: [ID] }]);
    expect(applyPreset(preset, [OTHER])).toEqual({ text: raw.caption, accountIds: [OTHER] });
    await fetchPresets(mockApi); expect(mockRequest).toHaveBeenCalledWith('/api/v1/social/presets');
});
test('draft problems and exact PUT/DELETE contracts', async () => {
    expect(presetDraftProblem(' ', 'x', [])).toBe('publishDepth.presets.nameRequired');
    for (const caption of ['', 'x'.repeat(4001)]) expect(presetDraftProblem('Name', caption, [])).toBe('publishDepth.presets.captionRequired');
    expect(presetDraftProblem('Name', 'Caption', Array(21).fill(ID))).toBe('publishDepth.presets.accountsLimit');
    expect(presetDraftProblem('Name', 'Caption', [])).toBeNull();
    await savePreset(mockApi, { id: null, name: ' New ', caption: ' Caption ', accountIds: [ID] });
    expect(JSON.parse(mockRequest.mock.calls[0][1].body)).toEqual({ id: null, name: 'New', caption: 'Caption', accountIds: [ID] }); expect(mockRequest.mock.calls[0][1].method).toBe('PUT');
    await deletePreset(mockApi, 'id&test'); expect(mockRequest).toHaveBeenLastCalledWith('/api/v1/social/presets?id=id%26test', { method: 'DELETE' });
});
test.each([[409, 'preset_name_taken', 'exists'], [409, 'preset_limit', 'limit'], [402, 'x', 'plan'], [403, 'x', 'role'], [404, 'preset_not_found', 'gone'], [429, 'x', 'rate'], [0, 'x', 'network'], [500, 'x', 'failed']])('error %s %s', (status, code, key) => {
    expect(presetErrorKey(new ApiError(status as number, code as string))).toBe(`publishDepth.presets.${key}`);
});
test.each([402, 403, 404, 503])('%s hides the component', async status => { mockRequest.mockRejectedValue(new ApiError(status, 'off')); await render(); expect(textOf(root.container)).toBe(''); });
test('Delete asks first and sends once after confirmation', async () => {
    await render(); await press(root, 'Launch'); await press(root, t('publishDepth.presets.delete'));
    expect(mockRequest.mock.calls.some(([, init]) => init?.method === 'DELETE')).toBe(false); expect(alert.mock.calls[0][1]).toContain('Launch');
    await confirm(); expect(mockRequest.mock.calls.filter(([, init]) => init?.method === 'DELETE')).toHaveLength(1);
});
test('queue mode disables Apply and Save but permits Delete', async () => {
    await render({ mode: 'queue' }); await press(root, 'Launch');
    for (const key of ['apply', 'save']) expect(buttons(root, t(`publishDepth.presets.${key}`))[0].props.accessibilityState.disabled).toBe(true);
    expect(buttons(root, t('publishDepth.presets.delete'))[0].props.accessibilityState.disabled).toBe(false);
    expect(textOf(root.container)).toContain(t('publishDepth.presets.queueNote'));
});
test('Apply confirms replacing overrides; resulting createBody has no networkText', async () => {
    await render({ networkText: { instagram: 'Override' } }); await press(root, 'Launch'); await press(root, t('publishDepth.presets.apply')); expect(applied).not.toHaveBeenCalled();
    await confirm(); expect(applied.mock.calls[0][0]).toEqual({ text: raw.caption, accountIds: [ID] });
    const value = applied.mock.calls[0][0]; const body = createBody({ ...value, networkText: {}, jobId: ID, mediaType: 'image', when: { kind: 'now' } }, 'key', new Date());
    expect(body.globalText).toBe(raw.caption); expect(body).not.toHaveProperty('networkText');
});
test('Save sends effective selected account IDs and updates selected preset', async () => {
    await render(); await press(root, 'Launch'); await press(root, t('publishDepth.presets.save')); await confirm();
    const put = mockRequest.mock.calls.find(([, init]) => init?.method === 'PUT');
    expect(JSON.parse(put[1].body)).toEqual({ id: ID, name: 'Launch', caption: 'Typed caption', accountIds: [OTHER] });
});
test('brand change while loading ignores the old list', async () => {
    const pending = deferred<unknown>(); mockRequest.mockReturnValueOnce(pending.promise).mockResolvedValue({ presets: [] }); await render();
    await act(async () => brandStore.set(OTHER)); await act(async () => pending.resolve({ presets: [raw] }));
    expect(buttons(root, 'Launch')).toHaveLength(0); expect(field(root, t('publishDepth.presets.name')).props.value).toBe('');
});
test.each(['delete', 'apply', 'save'])('brand change invalidates an open %s confirmation, including A -> B -> A', async action => {
    await render({ networkText: { instagram: 'Override' } }); await press(root, 'Launch'); await press(root, t(`publishDepth.presets.${action}`));
    await act(async () => { brandStore.set(OTHER); brandStore.set(null); }); mockRequest.mockClear(); await confirm();
    expect(mockRequest).not.toHaveBeenCalled(); expect(applied).not.toHaveBeenCalled(); expect(field(root, t('publishDepth.presets.name')).props.value).toBe('');
});
test('late save response after user change cannot restore state or reload new user', async () => {
    await render(); await press(root, 'Launch'); const pending = deferred<unknown>(); const original = mockRequest.getMockImplementation()!;
    mockRequest.mockImplementation((url, init) => init?.method === 'PUT' ? pending.promise : original(url, init));
    await press(root, t('publishDepth.presets.save')); await confirm(); await act(async () => { mockUser = 'other'; mockListeners.forEach(fn => fn()); });
    mockRequest.mockClear(); await act(async () => pending.resolve({})); expect(mockRequest).not.toHaveBeenCalled(); expect(field(root, t('publishDepth.presets.name')).props.value).toBe('');
});
test('parent clears applied preset caption, overrides and old accounts; stale submit cannot publish in new brand', async () => {
    await act(async () => root.render(createElement(Compose)));
    const creation = root.container.queryAll(n => n.props.accessibilityRole === 'button' && textOf(n).startsWith('Creation'))[0];
    await act(async () => { creation.props.onClick({ nativeEvent: {} }); });
    await press(root, 'Launch'); await press(root, t('publishDepth.presets.apply'));
    expect(field(root, t('publish.caption')).props.value).toBe(raw.caption);
    const overrideLabel = t('compose.networkText', { network: 'Instagram' });
    await input(root, overrideLabel, 'Old override');
    await press(root, t('publishDepth.presets.apply')); expect(alert).toHaveBeenCalled(); await confirm();
    expect(field(root, overrideLabel).props.value).toBe('');
    await input(root, overrideLabel, 'Brand A override');
    await press(root, 'In 1 hour');
    const submit = root.container.queryAll(n => n.props.accessibilityRole === 'button' && textOf(n) === t('publish.schedule') && n.props.accessibilityState?.disabled !== undefined)[0];
    await act(async () => { submit.props.onClick({ nativeEvent: {} }); }); expect(alert).toHaveBeenCalled();
    await act(async () => brandStore.set(OTHER)); mockRequest.mockClear(); await confirm();
    expect(mockRequest).not.toHaveBeenCalled(); expect(textOf(root.container)).toContain(t('publishDepth.presets.scopeCleared'));
    expect(root.container.queryAll(n => n.props.accessibilityLabel === t('publish.caption'))).toHaveLength(0);
    const nextCreation = root.container.queryAll(n => n.props.accessibilityRole === 'button' && textOf(n).startsWith('Creation'))[0];
    await act(async () => { nextCreation.props.onClick({ nativeEvent: {} }); });
    expect(field(root, t('publish.caption')).props.value).toBe('');
    const accountButton = root.container.queryAll(n => n.props.accessibilityRole === 'button' && textOf(n).startsWith('Studio'))[0];
    expect(accountButton.props.accessibilityState.selected).toBe(false);
    await act(async () => { accountButton.props.onClick({ nativeEvent: {} }); });
    expect(field(root, overrideLabel).props.value).toBe('');
    await input(root, t('publishDepth.presets.name'), 'B preset'); await press(root, t('publishDepth.presets.save'));
    expect(mockRequest.mock.calls.some(([, init]) => init?.method === 'PUT' || init?.method === 'POST')).toBe(false);
});
