import { act } from 'react';
import * as RN from 'react-native';
import { createRoot, type Root } from 'test-renderer';
import InboxThread from '../src/app/(app)/publish/inbox-thread';
import { t } from '../src/lib/i18n';
import { brandStore } from '../src/lib/publishBrand';
import { ID, OTHER, buttons, deferred, input, press, textOf } from './publishDepthTestHelpers';
const mockRequest = jest.fn(), mockApi = { request: mockRequest };
jest.mock('../src/lib/usePublishApi', () => ({ usePublishApi: () => mockApi }));
jest.mock('expo-router', () => ({ Stack: { Screen: () => null }, useLocalSearchParams: () => ({ id: '11111111-1111-4111-8111-111111111111' }) }));
jest.mock('../src/lib/appCache', () => ({ getCacheUser: () => 'u', subscribeCacheUser: () => () => {} }));
void [RN.Pressable, RN.TextInput, RN.Text, RN.View, RN.ScrollView, RN.StyleSheet, RN.ActivityIndicator, RN.Keyboard];
let root: Root, role = 'editor', unread = 2, canReply = true;
beforeEach(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true; brandStore.set(null); jest.clearAllMocks(); root = createRoot(); role = 'editor'; unread = 2; canReply = true;
    mockRequest.mockImplementation(async (path: string) => path.endsWith('/accounts') ? { brandRole: role } : path.endsWith('/suggestions') ? { suggestions: [] } : { thread: { id: ID, network: 'instagram', unread_count: unread, can_reply: canReply, tags: ['café'], priority: 'normal' }, messages: [], notes: [] });
});
afterEach(async () => { await act(async () => root.unmount()); brandStore.set(null); });
const render = async () => { await act(async () => root.render(<InboxThread />)); };
const patches = () => mockRequest.mock.calls.filter(([, init]) => init?.method === 'PATCH').map(([, init]) => JSON.parse(init.body));
test('read is sent once after role and thread load, with no loop on reload or failure', async () => {
    await render(); await render(); expect(patches()).toEqual([{ action: 'read' }]);
    await press(root, t('publishOps.priority.high')); expect(patches().filter(p => p.action === 'read')).toHaveLength(1);
});
test.each([['viewer', 2], ['editor', 0]])('%s unread %s never sends read', async (r, u) => { role = String(r); unread = Number(u); await render(); expect(patches()).toEqual([]); });
test('role loading cannot mark read or expose writes early', async () => {
    const wait = deferred<unknown>(), original = mockRequest.getMockImplementation()!;
    mockRequest.mockImplementation((path: string) => path.endsWith('/accounts') ? wait.promise : original(path));
    await render(); expect(patches()).toEqual([]); expect(buttons(root, t('publish.resolve'))).toHaveLength(0);
    await act(async () => wait.resolve({ brandRole: 'editor' })); expect(patches()).toEqual([{ action: 'read' }]);
});
test.each(['viewer', 'reviewer', 'editor'])('footer and controls for %s', async r => {
    role = r; canReply = r !== 'editor'; await render();
    expect(textOf(root.container)).toContain(t(r === 'viewer' ? 'publishOps.inbox.readOnlyRole' : r === 'reviewer' ? 'publishOps.inbox.triageRole' : 'publishOps.inbox.readOnlyConnection'));
    expect(textOf(root.container)).not.toContain(t('inbox.replyOnWeb'));
    for (const key of ['publish.resolve', 'publish.assign', 'publishOps.priority.high', 'publishOps.inbox.saveTags']) expect(buttons(root, t(key)).length > 0).toBe(r !== 'viewer');
    expect(buttons(root, t('publish.sendreply'))).toHaveLength(0);
});
test.each(['a'.repeat(33), '😀'.repeat(17)])('invalid tag sends no write: %s', async tag => {
    await render(); mockRequest.mockClear(); await input(root, t('publishOps.inbox.tags'), tag); await press(root, t('publishOps.inbox.saveTags')); expect(patches()).toEqual([]); expect(textOf(root.container)).toContain(t('publishOps.inbox.tagTooLong'));
});
test('web-created Unicode tags survive edits', async () => {
    await render(); mockRequest.mockClear(); await input(root, t('publishOps.inbox.tags'), 'café, vip'); await press(root, t('publishOps.inbox.saveTags'));
    expect(patches()).toEqual([{ action: 'tags', tags: ['café', 'vip'] }]);
});
test('a new scope can mark read once again', async () => { await render(); await act(async () => brandStore.set(OTHER)); expect(patches().filter(p => p.action === 'read')).toHaveLength(2); });

test('no role footer while the role loads', async () => {
    const pending = deferred<unknown>(), original = mockRequest.getMockImplementation()!;
    mockRequest.mockImplementation((path: string) => path.endsWith('/accounts') ? pending.promise : original(path));
    await render();
    for (const key of ['readOnlyConnection', 'triageRole', 'readOnlyRole']) expect(textOf(root.container)).not.toContain(t(`publishOps.inbox.${key}`));
    await act(async () => pending.resolve({ brandRole: 'editor' })); expect(textOf(root.container)).not.toContain(t('publishOps.inbox.readOnlyRole'));
});
