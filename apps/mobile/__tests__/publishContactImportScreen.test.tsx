import { act } from 'react';
import * as RN from 'react-native';
import { createRoot, type Root } from 'test-renderer';
import ContactImport from '../src/app/(app)/publish/contact-import';
import Contacts from '../src/app/(app)/publish/contacts';
import { t } from '../src/lib/i18n';
import { brandStore } from '../src/lib/publishBrand';
import { ID, OTHER, buttons, deferred, input, press, textOf } from './publishDepthTestHelpers';
const mockRequest = jest.fn(), mockApi = { request: mockRequest }, mockPicker = jest.fn(), mockText = jest.fn(), mockDiscard = jest.fn();
jest.mock('../src/lib/usePublishApi', () => ({ usePublishApi: () => mockApi }));
jest.mock('expo-router', () => ({ Stack: { Screen: () => null }, useRouter: () => ({ push: jest.fn(), back: jest.fn() }), useFocusEffect: (fn: () => void) => require('react').useEffect(fn, [fn]) }));
jest.mock('../src/lib/appCache', () => ({ getCacheUser: () => 'u', subscribeCacheUser: () => () => {} }));
jest.mock('expo-document-picker', () => ({ getDocumentAsync: (...args: any[]) => mockPicker(...args) }));
jest.mock('expo-file-system', () => ({ File: class { text() { return mockText(); } } }));
jest.mock('../src/lib/cacheFiles', () => ({ discardCacheCopy: (uri: unknown) => mockDiscard(uri) }));
void [RN.Pressable, RN.TextInput, RN.Text, RN.View, RN.ScrollView, RN.StyleSheet, RN.ActivityIndicator, RN.FlatList, RN.RefreshControl];
let root: Root, alert: jest.SpyInstance, role = 'editor';
const accounts = [{ id: ID, network: 'instagram', display_name: 'Active account', status: 'active' }, { id: OTHER, network: 'instagram', display_name: 'Revoked account', status: 'revoked' }];
const asset = { uri: 'file:///cache/import.csv', name: 'contacts.csv', size: 100 };
beforeEach(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true; brandStore.set(ID); jest.clearAllMocks(); root = createRoot(); role = 'editor';
    alert = jest.spyOn(RN.Alert, 'alert').mockImplementation(() => {});
    mockRequest.mockImplementation(async (path: string, init?: RequestInit) => path.endsWith('/accounts') ? { brandRole: role, accounts } : init?.method === 'POST' ? { imported: 1 } : { contacts: [] });
    mockPicker.mockResolvedValue({ canceled: false, assets: [asset] }); mockText.mockResolvedValue('external_id,name\na,A');
});
afterEach(async () => { await act(async () => root.unmount()); alert.mockRestore(); brandStore.set(null); });
const render = async (list = false) => { await act(async () => root.render(list ? <Contacts /> : <ContactImport />)); };
const sends = () => mockRequest.mock.calls.filter(([, init]) => init?.method === 'POST');
const accountLabel = t('publishOps.accountLabel', { network: 'Instagram', name: 'Active account' });
async function csvMode() { const tab = root.container.queryAll(n => n.props.accessibilityRole === 'tab' && textOf(n) === t('publishOps.import.csv')); expect(tab).toHaveLength(1); await act(async () => tab[0].props.onClick({ nativeEvent: {} })); }
async function manualConfirm() { await press(root, accountLabel); await input(root, t('publishOps.import.handle'), ' a '); await input(root, t('publishOps.import.name'), ' A '); await press(root, t('publishOps.import.add')); }
const confirmAdd = () => alert.mock.calls.at(-1)![2].find((b: any) => b.onPress).onPress;
test.each(['reviewer', 'viewer'])('direct navigation as %s fails closed', async r => {
    role = r; await render(); expect(textOf(root.container)).toContain(t('publishOps.import.notAllowed'));
    expect(root.container.queryAll(n => typeof n.props.onChangeText === 'function')).toHaveLength(0);
    expect(buttons(root, t('publishOps.import.choose'))).toHaveLength(0); expect(mockPicker).not.toHaveBeenCalled(); expect(sends()).toHaveLength(0);
});
test.each(['reviewer', 'editor'])('contacts import entry gated for %s', async r => { role = r; await render(true); expect(buttons(root, t('publishOps.import.title')).length).toBe(r === 'editor' ? 1 : 0); });
test('loading role shows only busy state and cannot pick', async () => {
    const wait = deferred<unknown>(); mockRequest.mockReturnValue(wait.promise); await render();
    expect(buttons(root, t('publishOps.import.choose'))).toHaveLength(0); expect(root.container.queryAll(n => n.props.accessibilityState?.busy).length).toBeGreaterThan(0); expect(mockPicker).not.toHaveBeenCalled();
    await act(async () => wait.resolve({ brandRole: 'viewer' }));
});
test('only active accounts, Cancel sends nothing, Add sends exact body once', async () => {
    await render(); expect(textOf(root.container)).not.toContain('Revoked account'); await manualConfirm();
    expect(alert.mock.calls.at(-1)![2].some((b: any) => b.style === 'cancel')).toBe(true); expect(sends()).toHaveLength(0);
    const add = confirmAdd(); await act(async () => { void add(); void add(); });
    expect(sends()).toHaveLength(1); expect(JSON.parse(sends()[0][1].body)).toEqual({ accountId: ID, source: 'manual', contacts: [{ externalId: 'a', name: 'A', tags: [], subscriptionStatus: 'unknown', notes: '' }] });
    expect(textOf(root.container)).toContain(t('publishOps.import.done', { count: 1 }));
});
test.each(['success', 'type', 'size', 'missingSize', 'read', 'parse'])('cache copy discarded after %s', async outcome => {
    if (outcome === 'type') mockPicker.mockResolvedValue({ canceled: false, assets: [{ ...asset, name: 'bad.txt' }] });
    if (outcome === 'size') mockPicker.mockResolvedValue({ canceled: false, assets: [{ ...asset, size: 32769 }] });
    if (outcome === 'missingSize') mockPicker.mockResolvedValue({ canceled: false, assets: [{ ...asset, size: undefined }] });
    if (outcome === 'read') mockText.mockRejectedValue(new Error('read'));
    if (outcome === 'parse') mockText.mockResolvedValue('bad');
    await render(); await csvMode(); await press(root, t('publishOps.import.choose'));
    expect(mockDiscard).toHaveBeenCalledWith(asset.uri);
    if (['type', 'size', 'missingSize'].includes(outcome)) expect(mockText).not.toHaveBeenCalled();
    if (outcome === 'success') expect(textOf(root.container)).toContain(t('publishOps.import.ready', { count: 1 }));
    expect(mockPicker).toHaveBeenCalledWith({ type: ['text/csv', 'text/comma-separated-values', 'text/plain', '*/*'], copyToCacheDirectory: true, multiple: false });
});
test.each(['unmount', 'scope'])('cache copy discarded during held read on %s', async action => {
    const wait = deferred<string>(); mockText.mockReturnValue(wait.promise); await render(); await csvMode(); await press(root, t('publishOps.import.choose'));
    await act(async () => { if (action === 'unmount') root.unmount(); else brandStore.set(OTHER); });
    expect(mockDiscard).toHaveBeenCalledWith(asset.uri); await act(async () => wait.resolve('external_id,name\na,A'));
    if (action === 'scope') expect(textOf(root.container)).not.toContain(t('publishOps.import.ready', { count: 1 }));
});
test('editor confirm and held old accounts cannot write after switch to viewer', async () => {
    const held = deferred<unknown>(); let reads = 0;
    mockRequest.mockImplementation((path: string) => path.endsWith('/accounts') ? (++reads === 2 ? held.promise : Promise.resolve({ brandRole: role, accounts })) : Promise.resolve({}));
    await render(); await act(async () => held.resolve({ accounts, brandRole: 'editor' })); await manualConfirm(); const add = confirmAdd();
    role = 'viewer'; await act(async () => brandStore.set(OTHER)); await act(async () => add());
    expect(sends()).toHaveLength(0); expect(textOf(root.container)).toContain(t('publishOps.import.notAllowed')); expect(buttons(root, t('publishOps.import.add'))).toHaveLength(0);
});
