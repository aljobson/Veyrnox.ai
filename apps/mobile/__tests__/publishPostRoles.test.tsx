import { act } from 'react';
import * as RN from 'react-native';
import { createRoot, type Root } from 'test-renderer';
import PostDetail from '../src/app/(app)/publish/post/[id]';
import Accounts from '../src/app/(app)/publish/accounts';
import { usePublishRole } from '../src/lib/usePublishRole';
import { brandStore } from '../src/lib/publishBrand';
import { t } from '../src/lib/i18n';
import type { ApiClient } from '../src/lib/api';
import { buttons, deferred, press, textOf, ID, OTHER } from './publishDepthTestHelpers';
const mockRequest = jest.fn(), mockApi = { request: mockRequest } as unknown as ApiClient;
var mockUser = 'owner';
var mockListeners = new Set<() => void>();
jest.mock('../src/lib/usePublishApi', () => ({ usePublishApi: () => mockApi }));
jest.mock('expo-router', () => ({ Stack: { Screen: () => null }, useLocalSearchParams: () => ({ id: 'post' }), useRouter: () => ({ push: jest.fn() }) }));
jest.mock('../src/lib/appCache', () => ({ getCacheUser: () => mockUser, subscribeCacheUser: (fn: () => void) => { (mockListeners ??= new Set()).add(fn); return () => mockListeners.delete(fn); } }));
void [RN.Pressable, RN.Text, RN.View, RN.ScrollView, RN.StyleSheet, RN.ActivityIndicator, RN.FlatList, RN.RefreshControl];
let root: Root, alert: jest.SpyInstance;
const owner = { brandRole: 'owner', accounts: [{ id: 'a', network: 'twitter', display_name: 'Owner account', status: 'active' }] };
const post = (status = 'scheduled', publish_status = 'pending', updated_at: string | null = 'stamp') => ({ id: 'post', status, updated_at, scheduled_at: '2026-11-01T12:00:00Z', targets: [{ id: 't', network: 'twitter', publish_status }] });
beforeEach(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true; brandStore.set(null); mockUser = 'owner'; jest.clearAllMocks(); root = createRoot();
    mockRequest.mockImplementation(async (path: string) => path.endsWith('/accounts') ? owner : { post: post() });
    alert = jest.spyOn(RN.Alert, 'alert').mockImplementation(() => {});
});
afterEach(async () => { await act(async () => root.unmount()); alert.mockRestore(); brandStore.set(null); });
const render = async (accounts = false) => { await act(async () => root.render(accounts ? <Accounts /> : <PostDetail />)); };
test.each(['viewer', 'reviewer', 'analyst'])('%s cannot change a scheduled post', async role => {
    mockRequest.mockImplementation(async (path: string) => path.endsWith('/accounts') ? { ...owner, brandRole: role } : { post: post() });
    await render();
    expect(textOf(root.container)).toContain(t('publishParity.post.readOnly'));
    expect(buttons(root, t('publish.changethetime'))).toHaveLength(0);
    expect(buttons(root, t('publish.cancelthispost'))).toHaveLength(0);
});
test.each([
    ['scheduled', 'pending', 'stamp', true, true, false, false],
    ['scheduled', 'publishing', 'stamp', false, false, false, true],
    ['canceled', 'pending', 'stamp', false, false, true, false],
    ['canceled', 'pending', null, false, false, false, false],
    ['canceled', 'published', 'stamp', false, false, false, true],
] as const)('editor actions for %s/%s/%s', async (status, target, stamp, reschedule, cancel, restore, locked) => {
    mockRequest.mockImplementation(async (path: string) => path.endsWith('/accounts') ? { ...owner, brandRole: 'editor' } : { post: post(status, target, stamp) });
    await render();
    expect(buttons(root, t('publish.changethetime')).length > 0).toBe(reschedule);
    expect(buttons(root, t('publish.cancelthispost')).length > 0).toBe(cancel);
    expect(buttons(root, t('publish.scheduleitagain')).length > 0).toBe(restore);
    expect(textOf(root.container).includes(t('publishParity.post.locked'))).toBe(locked);
});
test.each(['owner', 'editor'])('accounts write controls for %s', async role => {
    mockRequest.mockResolvedValue({ ...owner, brandRole: role }); await render(true);
    expect(buttons(root, t('accounts.disconnectAction')).length > 0).toBe(role === 'owner');
    expect(buttons(root, t('connect.title')).length > 0).toBe(role === 'owner');
    expect(textOf(root.container).includes(t('publishParity.accounts.ownerOnly'))).toBe(role !== 'owner');
    expect(textOf(root.container)).toContain('X');
});
function Role({ api = mockApi }: { api?: ApiClient }) { const role = usePublishRole(api); return <RN.Text>{role ?? 'loading'}</RN.Text>; }
test('role drops late brand A results and does not flash write access while loading', async () => {
    const wait = deferred<unknown>();
    mockRequest.mockImplementation(() => brandStore.get() === OTHER ? Promise.resolve({ brandRole: 'viewer' }) : wait.promise);
    await act(async () => root.render(<Role />)); expect(textOf(root.container)).toBe('loading');
    await act(async () => brandStore.set(OTHER)); expect(textOf(root.container)).toBe('viewer');
    await act(async () => wait.resolve({ brandRole: 'owner' })); expect(textOf(root.container)).toBe('viewer');
});
test('role refetches on user changes, ignores old API responses, and fails closed', async () => {
    const wait = deferred<unknown>(); mockRequest.mockReturnValue(wait.promise);
    await act(async () => root.render(<Role />));
    const otherRequest = jest.fn().mockRejectedValue(new Error('offline')), api = { request: otherRequest } as unknown as ApiClient;
    await act(async () => root.render(<Role api={api} />)); expect(textOf(root.container)).toBe('viewer');
    await act(async () => wait.resolve({ brandRole: 'owner' })); expect(textOf(root.container)).toBe('viewer');
    otherRequest.mockResolvedValue({ brandRole: 'editor' });
    await act(async () => { mockUser = 'another'; mockListeners.forEach(fn => fn()); });
    expect(otherRequest).toHaveBeenCalledTimes(2); expect(textOf(root.container)).toBe('editor');
});
test('held accounts for owned brand A cannot replace brand B viewer data or enable DELETE', async () => {
    brandStore.set(ID); const wait = deferred<unknown>();
    mockRequest.mockImplementation(() => brandStore.get() === ID ? wait.promise : Promise.resolve({ ...owner, brandRole: 'viewer', accounts: [] }));
    await render(true); await act(async () => brandStore.set(OTHER)); await act(async () => wait.resolve(owner));
    expect(buttons(root, t('accounts.disconnectAction'))).toHaveLength(0);
    expect(buttons(root, t('connect.title'))).toHaveLength(0);
    expect(textOf(root.container)).not.toContain('Owner account');
    expect(mockRequest.mock.calls.some(([, init]) => init?.method === 'DELETE')).toBe(false);
});
test.each([false, true])('disconnect confirmation is invalid after a brand switch (back to A: %s)', async back => {
    brandStore.set(ID); await render(true); await press(root, t('accounts.disconnectAction'));
    const confirm = alert.mock.calls[0][2].find((b: { onPress?: () => void }) => b.onPress).onPress;
    mockRequest.mockResolvedValue({ ...owner, brandRole: 'viewer' });
    await act(async () => { brandStore.set(OTHER); if (back) brandStore.set(ID); });
    await act(async () => confirm());
    expect(mockRequest.mock.calls.some(([, init]) => init?.method === 'DELETE')).toBe(false);
    expect(buttons(root, t('accounts.disconnectAction'))).toHaveLength(0);
});
test.each([false, true])('late disconnect completion cannot overwrite next brand notice (error: %s)', async fails => {
    await render(true); await press(root, t('accounts.disconnectAction'));
    const wait = deferred<unknown>();
    mockRequest.mockImplementation((path: string, init?: RequestInit) => init?.method === 'DELETE' ? wait.promise : Promise.resolve({ ...owner, brandRole: 'viewer' }));
    await act(async () => alert.mock.calls[0][2].find((b: { onPress?: () => void }) => b.onPress).onPress());
    await act(async () => brandStore.set(OTHER));
    await act(async () => { if (fails) wait.reject(new Error('failed')); else wait.resolve({}); });
    expect(textOf(root.container)).toContain('Owner account');
    expect(textOf(root.container)).not.toContain(t('accounts.disconnected', { name: 'Owner account', network: 'X' }));
    expect(buttons(root, t('accounts.disconnectAction'))).toHaveLength(0);
});
