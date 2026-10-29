import { act, type ComponentType } from 'react';
import * as RN from 'react-native';
import { createRoot, type Root } from 'test-renderer';
import Ads from '../src/app/(app)/publish/ads';
import AdsEdit from '../src/app/(app)/publish/ads-edit';
import Commerce from '../src/app/(app)/publish/commerce';
import CommerceEdit from '../src/app/(app)/publish/commerce-edit';
import ContactEdit from '../src/app/(app)/publish/contact-edit';
import { ApiError } from '../src/lib/api';
import { t } from '../src/lib/i18n';
import { brandStore } from '../src/lib/publishBrand';
import { ID, OTHER, buttons, deferred, input, press, textOf } from './publishDepthTestHelpers';
const mockRequest = jest.fn(), mockApi = { request: mockRequest }, mockBack = jest.fn();
const mockUserListeners: Set<() => void> = require('../src/lib/appCache').testListeners;
jest.mock('../src/components/UnlockCard', () => ({ UnlockCard: () => require('react').createElement(require('react-native').Text, null, 'Locked') }));
jest.mock('../src/lib/usePublishApi', () => ({ usePublishApi: () => mockApi }));
jest.mock('expo-router', () => ({ Stack: { Screen: () => null }, useLocalSearchParams: () => ({ id: '11111111-1111-4111-8111-111111111111', accountId: '11111111-1111-4111-8111-111111111111', externalId: 'contact' }), useRouter: () => ({ push: jest.fn(), back: mockBack }), useFocusEffect: (fn: () => void) => require('react').useEffect(fn, [fn]) }));
jest.mock('../src/lib/appCache', () => { const listeners = new Set<() => void>(); return { testListeners: listeners, getCacheUser: () => 'u', subscribeCacheUser: (fn: () => void) => { listeners.add(fn); return () => listeners.delete(fn); } }; });
void [RN.Pressable, RN.TextInput, RN.Text, RN.View, RN.ScrollView, RN.StyleSheet, RN.ActivityIndicator, RN.FlatList, RN.RefreshControl, RN.KeyboardAvoidingView];
let root: Root, alert: jest.SpyInstance, role: string;
const page = (brandRole = role, name = 'Current row') => ({ brandRole,
    campaigns: [{ id: ID, name, network: 'meta', objective: 'awareness', status: 'draft', daily_budget_cents: 1500, currency: 'GBP' }],
    products: [{ id: ID, title: name, status: 'draft', source: 'manual', price_cents: 1500, currency: 'GBP', inventory_quantity: 2 }],
    contacts: [{ account_id: ID, external_id: 'contact', name, notes: 'Private note', tags: ['vip'] }], posts: [],
});
type ScreenCase = [string, ComponentType, string[]];
const lists: ScreenCase[] = [['ads', Ads, ['ads.new', 'ads.delete']], ['commerce', Commerce, ['commerce.new', 'commerce.archive']]];
const edits: ScreenCase[] = [['ads-edit', AdsEdit, ['ads.save']], ['commerce-edit', CommerceEdit, ['commerce.save', 'commerce.addOption']], ['contact-edit', ContactEdit, ['contacts.save']]];
const screens = [...lists, ...edits];
beforeEach(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true; brandStore.set(ID); jest.clearAllMocks(); mockRequest.mockReset(); root = createRoot(); role = 'editor';
    alert = jest.spyOn(RN.Alert, 'alert').mockImplementation(() => {}); mockRequest.mockImplementation(async () => page());
});
afterEach(async () => { await act(async () => root.unmount()); alert.mockRestore(); brandStore.set(null); });
const render = async (Screen: ComponentType) => { await act(async () => root.render(<Screen />)); };
const writes = () => mockRequest.mock.calls.filter(([, init]) => init?.method && init.method !== 'GET');
const noWrites = (labels: string[]) => { for (const key of labels) expect(buttons(root, t(key))).toHaveLength(0); };
const refresh = async () => { await act(async () => { const control = root.container.queryAll(n => n.props.refreshControl?.props.onRefresh)[0]; control.props.refreshControl.props.onRefresh(); }); };
const confirm = () => alert.mock.calls.at(-1)![2].find((b: any) => b.onPress).onPress;

test.each(screens)('viewer sees no write controls on %s', async (_, Screen, labels) => {
    role = Screen === ContactEdit ? 'analyst' : 'viewer'; await render(Screen); noWrites(labels); expect(writes()).toHaveLength(0);
    for (const field of root.container.queryAll(n => typeof n.props.onChangeText === 'function')) expect(field.props.editable).toBe(false);
});
test.each(screens)('editor can write on %s', async (_, Screen, labels) => { await render(Screen); for (const key of labels) expect(buttons(root, t(key))).toHaveLength(1); });
test.each(screens)('failed read leaves %s read-only', async (_, Screen, labels) => {
    mockRequest.mockRejectedValue(new ApiError(500, 'failed')); await render(Screen); noWrites(labels); expect(writes()).toHaveLength(0);
});
test.each(screens)('held editor-brand read cannot restore %s writes after switch to viewer', async (_, Screen, labels) => {
    const old = deferred<unknown>(); mockRequest.mockImplementation(() => brandStore.get() === ID ? old.promise : Promise.resolve(page('viewer', 'Viewer row')));
    await render(Screen); await act(async () => brandStore.set(OTHER)); await act(async () => old.resolve(page('editor', 'Old row')));
    noWrites(labels); expect(textOf(root.container)).not.toContain('Old row'); expect(writes()).toHaveLength(0);
});
test.each(lists)('old delete confirmation on %s sends nothing after A-B-A', async (_, Screen, labels) => {
    await render(Screen); await press(root, t(labels[1])); const action = confirm();
    await act(async () => { brandStore.set(OTHER); brandStore.set(ID); }); await act(async () => action()); expect(writes()).toHaveLength(0);
});
test.each(lists)('newer viewer read wins over an older editor read on %s', async (_, Screen, labels) => {
    await render(Screen); const old = deferred<unknown>(), newer = deferred<unknown>();
    mockRequest.mockImplementationOnce(() => old.promise).mockImplementationOnce(() => newer.promise);
    await refresh(); await refresh(); await act(async () => newer.resolve(page('viewer'))); await act(async () => old.resolve(page('editor'))); noWrites(labels);
});
test.each(lists)('lost role invalidates an open confirmation on %s', async (_, Screen, labels) => {
    await render(Screen); await press(root, t(labels[1])); const action = confirm(); role = 'viewer'; await refresh();
    await act(async () => action()); expect(writes()).toHaveLength(0);
});
test.each(lists)('old error cannot replace a newer list on %s', async (_, Screen, labels) => {
    await render(Screen); const old = deferred<unknown>(); mockRequest.mockImplementationOnce(() => old.promise); await refresh(); await refresh();
    await act(async () => old.reject(new ApiError(402, 'old'))); expect(textOf(root.container)).not.toContain('Locked'); expect(buttons(root, t(labels[0]))).toHaveLength(1);
});
test.each(edits)('save spanning a switch does not leave %s busy', async (_, Screen, labels) => {
    await render(Screen); const old = deferred<unknown>(), newer = deferred<unknown>(); let saves = 0;
    mockRequest.mockImplementation((_path, init) => init?.method ? (++saves === 1 ? old.promise : newer.promise) : Promise.resolve(page()));
    await press(root, t(labels[0])); expect(writes()).toHaveLength(1);
    await act(async () => brandStore.set(OTHER)); await act(async () => brandStore.set(ID));
    expect(buttons(root, t(labels[0]))[0].props.accessibilityState.disabled).toBe(false); await press(root, t(labels[0])); expect(writes()).toHaveLength(2);
    await act(async () => old.resolve({})); expect(mockBack).not.toHaveBeenCalled(); expect(buttons(root, t(labels[0]))).toHaveLength(0);
    const pending = root.container.queryAll(n => n.props.accessibilityRole === 'button' && n.props.accessibilityState?.disabled === true);
    expect(pending.length).toBeGreaterThan(0); await act(async () => newer.resolve({})); expect(mockBack).toHaveBeenCalledTimes(1);
});
test.each(edits)('scope change clears the %s form and sends no write', async (_, Screen, labels) => {
    await render(Screen); const label = t(Screen === AdsEdit ? 'ads.name' : Screen === CommerceEdit ? 'commerce.name' : 'contacts.notes');
    await input(root, label, 'Unsaved private draft'); const read = deferred<unknown>(); mockRequest.mockReturnValue(read.promise);
    await act(async () => brandStore.set(OTHER)); noWrites(labels); expect(textOf(root.container)).not.toContain('Unsaved private draft');
    expect(root.container.queryAll(n => typeof n.props.onChangeText === 'function')).toHaveLength(0);
    expect(root.container.queryAll(n => n.type === 'ActivityIndicator').length).toBeGreaterThan(0); expect(writes()).toHaveLength(0);
    await act(async () => read.resolve(page())); const save = deferred<unknown>();
    mockRequest.mockImplementation((_path, init) => init?.method ? save.promise : Promise.resolve(page('viewer')));
    await press(root, t(labels[0])); await act(async () => brandStore.set(ID)); await act(async () => save.resolve({}));
    expect(mockBack).not.toHaveBeenCalled(); noWrites(labels);
});
test.each(screens)('user reset clears %s writes before its next read', async (_, Screen, labels) => {
    await render(Screen); const read = deferred<unknown>(); mockRequest.mockReturnValue(read.promise);
    await act(async () => mockUserListeners.forEach(fn => fn())); noWrites(labels);
    await act(async () => read.resolve(page('viewer'))); noWrites(labels);
});
