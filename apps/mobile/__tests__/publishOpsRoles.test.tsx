import { act, type ComponentType } from 'react';
import * as RN from 'react-native';
import { createRoot, type Root } from 'test-renderer';
import Workflows from '../src/app/(app)/publish/workflows';
import Queues from '../src/app/(app)/publish/queues';
import QueueEdit from '../src/app/(app)/publish/queue-edit';
import Autolists from '../src/app/(app)/publish/autolists';
import AutolistEdit from '../src/app/(app)/publish/autolist-edit';
import Smartlink from '../src/app/(app)/publish/smartlink';
import Ads from '../src/app/(app)/publish/ads';
import Commerce from '../src/app/(app)/publish/commerce';
import { t } from '../src/lib/i18n';
import { brandStore } from '../src/lib/publishBrand';
import { ID, OTHER, buttons, deferred, press, textOf } from './publishDepthTestHelpers';
const mockRequest = jest.fn(), mockApi = { request: mockRequest };
jest.mock('../src/components/UnlockCard', () => ({ UnlockCard: () => require('react').createElement(require('react-native').Text, null, 'Locked inbox') }));
jest.mock('../src/lib/usePublishApi', () => ({ usePublishApi: () => mockApi }));
jest.mock('expo-router', () => ({ Stack: { Screen: () => null }, useLocalSearchParams: () => ({ id: '11111111-1111-4111-8111-111111111111' }), useRouter: () => ({ push: jest.fn(), back: jest.fn() }), useFocusEffect: (fn: () => void) => require('react').useEffect(fn, [fn]) }));
jest.mock('../src/lib/appCache', () => ({ getCacheUser: () => 'u', subscribeCacheUser: () => () => {} }));
void [RN.Pressable, RN.TextInput, RN.Text, RN.View, RN.ScrollView, RN.StyleSheet, RN.ActivityIndicator, RN.FlatList, RN.RefreshControl, RN.Switch];
let root: Root, alert: jest.SpyInstance, role = 'editor';
const revoked = '33333333-3333-4333-8333-333333333333', unknown = '44444444-4444-4444-8444-444444444444';
const accounts = [
    { id: ID, network: 'instagram', display_name: 'Eligible', status: 'active', publishingEnabled: true },
    { id: OTHER, network: 'instagram', display_name: 'Publishing off', status: 'active', publishingEnabled: false },
    { id: revoked, network: 'instagram', display_name: 'Revoked', status: 'revoked', publishingEnabled: true },
];
const queue = { id: ID, name: 'Saved queue', timezone: 'UTC', account_ids: [ID, OTHER, revoked, unknown], enabled: true, slots: [{ weekday: 1, minute: 540 }] };
const responses = (path: string): unknown => path.endsWith('/accounts') ? { brandRole: role, accounts } : path.includes('/queues') ? { queues: [queue] } : path.includes('/autolists') ? { autolists: [{ id: ID, name: 'Feed', queue_id: ID, feed_url: 'https://example.com/feed', enabled: true }] } : path.includes('/workflows') ? { workflows: [{ id: ID, name: 'Welcome', keyword: 'hi', reply_text: 'Hello', enabled: true, kind: 'comment', match_mode: 'exact' }] } : path.includes('/smartlink') ? { smartlink: { slug: 'studio', title: 'Studio', published: true }, items: [{ label: 'Site', url: 'https://example.com', enabled: true }] } : {};
const screens: [string, ComponentType, string[]][] = [
    ['workflows', Workflows, ['publish.newworkflow2', 'publish.edit', 'publish.delete']],
    ['queues', Queues, ['queues.new', 'queues.delete']], ['autolists', Autolists, ['autolists.new', 'autolists.delete']],
    ['queue-edit', QueueEdit, ['queues.save']], ['autolist-edit', AutolistEdit, ['autolists.save']], ['smartlink', Smartlink, ['smartlink.save']],
];
beforeEach(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true; brandStore.set(ID); jest.clearAllMocks(); root = createRoot(); role = 'editor';
    alert = jest.spyOn(RN.Alert, 'alert').mockImplementation(() => {}); mockRequest.mockImplementation(async (path: string) => responses(path));
});
afterEach(async () => { await act(async () => root.unmount()); alert.mockRestore(); brandStore.set(null); });
const render = async (Screen: ComponentType) => { await act(async () => root.render(<Screen />)); };
const writes = () => mockRequest.mock.calls.filter(([, init]) => init?.method && init.method !== 'GET');
test.each(screens)('viewer gates %s', async (_, Screen, labels) => {
    role = 'viewer'; await render(Screen); expect(textOf(root.container)).toContain(t('publishOps.readOnly'));
    for (const key of labels) expect(buttons(root, t(key))).toHaveLength(0);
    for (const field of root.container.queryAll(n => typeof n.props.onChangeText === 'function')) expect(field.props.editable).toBe(false);
    if (Screen === Smartlink) expect(buttons(root, t('smartlink.share'))).toHaveLength(1);
    expect(writes()).toHaveLength(0);
});
test.each(screens)('editor can write %s', async (_, Screen, labels) => { await render(Screen); for (const key of labels) expect(buttons(root, t(key))).toHaveLength(1); });
test('saved queue displays exclusions and only sends eligible IDs', async () => {
    await render(QueueEdit); const text = textOf(root.container);
    expect(text).toContain(t('publishOps.queue.excludedTitle')); expect(text).toContain(t('publishOps.queue.reason.publishingOff')); expect(text).toContain(t('publishOps.queue.reason.disconnected')); expect(text).toContain(t('publishOps.queue.unknownAccounts', { count: 1 }));
    expect(buttons(root, t('publishOps.accountLabel', { network: 'Instagram', name: 'Publishing off' }))).toHaveLength(0);
    await press(root, t('queues.save')); expect(JSON.parse(writes()[0][1].body).accountIds).toEqual([ID]);
});
test('queue save with no eligible selection fails locally', async () => {
    await render(QueueEdit); await press(root, t('publishOps.accountLabel', { network: 'Instagram', name: 'Eligible' })); await press(root, t('queues.save'));
    expect(textOf(root.container)).toContain(t('queues.err.accounts')); expect(writes()).toHaveLength(0);
});
test.each(screens)('held editor-brand loads cannot restore %s writes after switch to viewer', async (_, Screen, labels) => {
    const held = deferred<unknown>();
    mockRequest.mockImplementation((path: string) => brandStore.get() === ID ? held.promise : Promise.resolve(responses(path)));
    await render(Screen); role = 'viewer'; await act(async () => brandStore.set(OTHER));
    await act(async () => held.resolve({ brandRole: 'editor', accounts, queues: [queue], workflows: [], autolists: [] }));
    expect(textOf(root.container)).toContain(t('publishOps.readOnly')); for (const key of labels) expect(buttons(root, t(key))).toHaveLength(0); expect(writes()).toHaveLength(0);
});
test.each(screens.slice(0, 3))('old delete confirmation for %s cannot send after scope change', async (_, Screen, labels) => {
    await render(Screen);
    const deleteKey = labels.at(-1)!;
    const targets = buttons(root, t(deleteKey)); expect(targets).toHaveLength(1);
    await act(async () => targets[0].props.onClick({ nativeEvent: {} }));
    const add = alert.mock.calls.at(-1)![2].find((b: any) => b.onPress).onPress;
    role = 'viewer'; await act(async () => { brandStore.set(OTHER); brandStore.set(ID); }); await act(async () => add()); expect(writes()).toHaveLength(0);
});
test.each([Ads, Commerce])('working lists do not render coming-to-app', async Screen => { await render(Screen); expect(textOf(root.container)).not.toContain(t('common.comingToApp')); });
