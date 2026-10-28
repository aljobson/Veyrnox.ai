import { act } from 'react';
import * as RN from 'react-native';
import { createRoot, type Root } from 'test-renderer';
import Inbox from '../src/app/(app)/publish/inbox';
import { ApiError } from '../src/lib/api';
import { t } from '../src/lib/i18n';
import { brandStore } from '../src/lib/publishBrand';
import { ID, OTHER, deferred, press, textOf } from './publishDepthTestHelpers';
const mockRequest = jest.fn(), mockApi = { request: mockRequest };
jest.mock('../src/components/UnlockCard', () => ({ UnlockCard: () => require('react').createElement(require('react-native').Text, null, 'Locked inbox') }));
jest.mock('../src/lib/usePublishApi', () => ({ usePublishApi: () => mockApi }));
jest.mock('expo-router', () => ({ Stack: { Screen: () => null }, useRouter: () => ({ push: jest.fn() }), useFocusEffect: (fn: () => void) => require('react').useEffect(fn, [fn]) }));
jest.mock('../src/lib/appCache', () => ({ getCacheUser: () => 'u', subscribeCacheUser: () => () => {} }));
void [RN.Pressable, RN.TextInput, RN.Text, RN.View, RN.FlatList, RN.StyleSheet, RN.ActivityIndicator, RN.RefreshControl];
let root: Root;
const listing = (name: string, tags = ['vip']) => ({ threads: [{ id: ID, participant_name: name, preview: 'Preview', network: 'instagram', kind: 'message' }], counts: { all: 1, resolved: 1 }, members: [{ user_id: OTHER, email: name + '@example.com' }], tags });
const accounts = { accounts: [{ id: ID, network: 'instagram', display_name: 'Active account', status: 'active' }] };
beforeEach(() => { (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true; brandStore.set(ID); jest.clearAllMocks(); root = createRoot(); mockRequest.mockImplementation(async (path: string) => path.endsWith('/accounts') ? accounts : listing('Current')); });
afterEach(async () => { await act(async () => root.unmount()); brandStore.set(null); });
const render = async () => { await act(async () => root.render(<Inbox />)); };
const text = () => textOf(root.container);
const filters = () => press(root, t('publishOps.inbox.filters'));
const accountLabel = t('publishOps.accountLabel', { network: 'Instagram', name: 'Active account' });
test('filter changes reach query, empty account wording, stale copy gone and clear on brand change', async () => {
    await render(); expect(text()).not.toContain(t('inbox.readOnly')); await filters();
    await press(root, accountLabel); await press(root, t('publishOps.priority.high')); await press(root, 'vip');
    expect(mockRequest.mock.calls.at(-1)[0]).toContain(`accountId=${ID}&priority=high&tag=vip`);
    mockRequest.mockImplementation(async (path: string) => path.endsWith('/accounts') ? accounts : { threads: [], tags: ['vip'] });
    await press(root, t('publishOps.priority.urgent')); expect(text()).toContain(t('publishOps.inbox.emptyAccount'));
    await act(async () => brandStore.set(OTHER)); expect(mockRequest.mock.calls.some(([path]) => path === '/api/v1/social/inbox?state=unresolved')).toBe(true); expect(text()).not.toContain(t('publishOps.inbox.emptyAccount'));
});
test.each([false, true])('stale A listing ignored, including A-B-A: %s', async back => {
    const first = deferred<unknown>(), next = deferred<unknown>(); let reads = 0;
    mockRequest.mockImplementation((path: string) => path.endsWith('/accounts') ? Promise.resolve(accounts) : ++reads === 1 ? first.promise : next.promise);
    await render(); await act(async () => { brandStore.set(OTHER); if (back) brandStore.set(ID); });
    await act(async () => next.resolve(listing('New brand', ['newtag']))); await act(async () => first.resolve(listing('Old brand', ['oldtag'])));
    await filters(); expect(text()).toContain('New brand'); expect(text()).not.toContain('Old brand'); expect(text()).not.toContain('oldtag');
});
test('old rows disappear immediately during brand change', async () => {
    await render(); const wait = deferred<unknown>(); mockRequest.mockReturnValue(wait.promise);
    await act(async () => brandStore.set(OTHER)); expect(text()).not.toContain('Current');
    await act(async () => wait.resolve({ threads: [] }));
});
test('urgent wins when earlier high finishes last', async () => {
    await render(); await filters(); const high = deferred<unknown>(), urgent = deferred<unknown>();
    mockRequest.mockImplementation((path: string) => path.includes('priority=high') ? high.promise : urgent.promise);
    await press(root, t('publishOps.priority.high')); await press(root, t('publishOps.priority.urgent'));
    await act(async () => urgent.resolve(listing('Urgent row'))); await act(async () => high.resolve(listing('High row')));
    expect(text()).toContain('Urgent row'); expect(text()).not.toContain('High row');
});
test.each([402, 500])('stale error %s cannot lock or replace listing', async status => {
    const old = deferred<unknown>(); let reads = 0;
    mockRequest.mockImplementation((path: string) => path.endsWith('/accounts') ? Promise.resolve(accounts) : ++reads === 1 ? old.promise : Promise.resolve(listing('New brand')));
    await render(); await act(async () => brandStore.set(OTHER)); await act(async () => old.reject(new ApiError(status, 'old')));
    expect(text()).toContain('New brand'); expect(text()).not.toContain(t('inbox.err.later')); expect(text()).not.toContain('Locked inbox');
});
test.each([false, true])('independent accounts/listing reads both apply, accounts first: %s', async accountsFirst => {
    const list = deferred<unknown>(), acc = deferred<unknown>();
    mockRequest.mockImplementation((path: string) => path.endsWith('/accounts') ? acc.promise : list.promise);
    await render(); await filters();
    await act(async () => { if (accountsFirst) acc.resolve(accounts); else list.resolve(listing('Concurrent')); });
    await act(async () => { if (accountsFirst) list.resolve(listing('Concurrent')); else acc.resolve(accounts); });
    expect(text()).toContain('Concurrent'); expect(text()).toContain('Active account');
});
test('filter read does not invalidate held account read', async () => {
    const old = deferred<unknown>(), next = deferred<unknown>(), acc = deferred<unknown>(); let reads = 0;
    mockRequest.mockImplementation((path: string) => path.endsWith('/accounts') ? acc.promise : ++reads === 1 ? old.promise : next.promise);
    await render(); await filters(); await press(root, t('publishOps.priority.high'));
    await act(async () => { next.resolve(listing('Filtered')); acc.resolve(accounts); }); await act(async () => old.resolve(listing('Stale')));
    expect(text()).toContain('Filtered'); expect(text()).toContain('Active account'); expect(text()).not.toContain('Stale');
});
test('accounts failure leaves rows and listing state untouched', async () => {
    const acc = deferred<unknown>(); mockRequest.mockImplementation((path: string) => path.endsWith('/accounts') ? acc.promise : Promise.resolve(listing('Unaffected')));
    await render(); await act(async () => acc.reject(new ApiError(402, 'accounts'))); await filters();
    expect(text()).toContain('Unaffected'); expect(text()).not.toContain(t('inbox.err.plan')); expect(text()).not.toContain('Locked inbox');
});
