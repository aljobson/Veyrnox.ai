import { act, type ComponentType } from 'react';
import * as RN from 'react-native';
import { createRoot, type Root } from 'test-renderer';
import Developer from '../src/app/(app)/publish/developer';
import { DeveloperKeys } from '../src/components/developer/DeveloperKeys';
import { DeveloperWebhooks } from '../src/components/developer/DeveloperWebhooks';
import { DeveloperLogs } from '../src/components/developer/DeveloperLogs';
import { ApiError } from '../src/lib/api';
import { t } from '../src/lib/i18n';
import { brandStore } from '../src/lib/publishBrand';
import { ID, OTHER, buttons, deferred, field, input, press, textOf } from './publishDepthTestHelpers';
const mockRequest = jest.fn(), mockApi = { request: mockRequest };
jest.mock('../src/lib/usePublishApi', () => ({ usePublishApi: () => mockApi }));
jest.mock('expo-router', () => ({ Stack: { Screen: () => null } }));
jest.mock('../src/lib/appCache', () => ({ getCacheUser: () => 'u', subscribeCacheUser: () => () => {} }));
void [RN.Pressable, RN.TextInput, RN.Text, RN.View, RN.ScrollView, RN.StyleSheet, RN.ActivityIndicator];
let root: Root, alert: jest.SpyInstance, role: string;
const listing = (label = 'Current key') => ({ keys: [{ id: ID, label, key_prefix: 'prefix', scopes: ['accounts:read'] }], endpoints: [{ id: ID, label, url: 'https://example.com/hook', events: ['post.published'] }], logs: [{ id: ID, method: 'GET', route: label }] });
beforeEach(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true; brandStore.set(ID); jest.clearAllMocks(); mockRequest.mockReset(); root = createRoot(); role = 'owner';
    alert = jest.spyOn(RN.Alert, 'alert').mockImplementation(() => {});
    mockRequest.mockImplementation(async (path, init) => path.endsWith('/accounts') ? { brandRole: role } : init?.method === 'POST' ? { api_key: 'private-key-secret', signing_secret: 'private-signing-secret' } : listing());
});
afterEach(async () => { await act(async () => root.unmount()); alert.mockRestore(); brandStore.set(null); });
const render = async (Screen: ComponentType = Developer) => { await act(async () => root.render(<Screen />)); };
const requests = () => mockRequest.mock.calls.filter(([path]) => path.includes('/developer/'));
const writes = () => requests().filter(([, init]) => init?.method);
const tabs = () => root.container.queryAll(n => n.props.accessibilityRole === 'tab');
test.each(['editor', 'reviewer', 'analyst', 'viewer'])('%s sees the role notice and no developer request', async r => {
    role = r; await render(); expect(textOf(root.container)).toContain(t('dev.err.role')); expect(tabs()).toHaveLength(0); expect(requests()).toHaveLength(0);
});
test('role loading shows a spinner and sends nothing', async () => {
    const pending = deferred<unknown>(); mockRequest.mockReturnValue(pending.promise); await render(); expect(tabs()).toHaveLength(0); expect(requests()).toHaveLength(0);
    expect(root.container.queryAll(n => n.type === 'ActivityIndicator').length).toBeGreaterThan(0); await act(async () => pending.resolve({ brandRole: 'viewer' }));
});
test.each(['owner', 'manager'])('%s loads keys', async r => { role = r; await render(); expect(tabs()).toHaveLength(3); expect(requests()[0][0]).toBe('/api/v1/social/developer/keys'); });
const components: [string, ComponentType, string, string][] = [
    ['key', DeveloperKeys, 'dev.keys.create', 'private-key-secret'], ['webhook', DeveloperWebhooks, 'dev.hooks.create', 'private-signing-secret'],
];
const fillCreate = async (Screen: ComponentType) => { await input(root, t('dev.label'), 'My integration'); if (Screen === DeveloperWebhooks) await input(root, t('dev.hooks.url'), 'https://example.com/hook'); };
test.each(components)('a shown %s secret disappears on brand change', async (_, Screen, create, secret) => {
    await render(Screen); await fillCreate(Screen); await press(root, t(create)); expect(textOf(root.container)).toContain(secret);
    await act(async () => brandStore.set(OTHER)); expect(textOf(root.container)).not.toContain(secret); expect(field(root, t('dev.label')).props.value).toBe('');
});
test.each(components)('held %s list from brand A is dropped after switch', async (_, Screen) => {
    const old = deferred<unknown>(); mockRequest.mockImplementation(() => brandStore.get() === ID ? old.promise : Promise.resolve(listing('Brand B')));
    await render(Screen); await act(async () => brandStore.set(OTHER)); await act(async () => old.resolve(listing('Brand A')));
    expect(textOf(root.container)).toContain('Brand B'); expect(textOf(root.container)).not.toContain('Brand A');
});
test.each(components)('old %s create completion cannot restore a secret or end a new create', async (_, Screen, create, secret) => {
    await render(Screen); const old = deferred<unknown>(), newer = deferred<unknown>(); let creates = 0;
    mockRequest.mockImplementation((_path, init) => init?.method === 'POST' ? (++creates === 1 ? old.promise : newer.promise) : Promise.resolve(listing()));
    await fillCreate(Screen); await press(root, t(create)); await act(async () => brandStore.set(OTHER)); await fillCreate(Screen); await press(root, t(create));
    await act(async () => old.resolve({ api_key: secret, signing_secret: secret })); expect(textOf(root.container)).not.toContain(secret);
    expect(buttons(root, t(create))[0].props.accessibilityState.disabled).toBe(true);
    await act(async () => newer.resolve({ api_key: 'new-secret', signing_secret: 'new-secret' })); expect(textOf(root.container)).toContain('new-secret');
});
test.each(components)('old %s revoke confirmation sends nothing after A-B-A', async (kind, Screen) => {
    await render(Screen); await press(root, t(kind === 'key' ? 'dev.keys.revokeNamed' : 'dev.hooks.revokeNamed', { name: 'Current key' }));
    const onPress = alert.mock.calls.at(-1)![2].find((b: any) => b.onPress).onPress;
    await act(async () => { brandStore.set(OTHER); brandStore.set(ID); }); await act(async () => onPress()); expect(writes()).toHaveLength(0);
});
test('an older log search does not land under a newer filter', async () => {
    await render(DeveloperLogs); const old = deferred<unknown>(), newer = deferred<unknown>();
    mockRequest.mockImplementation((path: string) => path.includes('status=error') ? newer.promise : old.promise);
    await input(root, t('dev.logs.search'), 'a'); await act(async () => field(root, t('dev.logs.search')).props.onSubmitEditing());
    const errorTab = tabs().find(n => textOf(n) === t('dev.logs.s.error'))!; await act(async () => errorTab.props.onClick({ nativeEvent: {} }));
    await act(async () => newer.resolve(listing('new-result'))); await act(async () => old.resolve(listing('old-result')));
    expect(textOf(root.container)).toContain('new-result'); expect(textOf(root.container)).not.toContain('old-result'); expect(requests().at(-1)[0]).toContain('status=error&q=a');
});
test('old log failure cannot replace a newer result', async () => {
    await render(DeveloperLogs); const old = deferred<unknown>(); mockRequest.mockImplementationOnce(() => old.promise);
    await press(root, t('acct.oauth.refresh')); await press(root, t('acct.oauth.refresh')); await act(async () => old.reject(new ApiError(403, 'old')));
    expect(textOf(root.container)).toContain('Current key'); expect(textOf(root.container)).not.toContain(t('dev.err.role'));
});
