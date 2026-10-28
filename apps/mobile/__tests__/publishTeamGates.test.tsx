import { act } from 'react';
import * as RN from 'react-native';
import { createRoot, type Root } from 'test-renderer';
import TeamScreen from '../src/app/(app)/publish/team';
import { t } from '../src/lib/i18n';
import { brandStore } from '../src/lib/publishBrand';
import { ID, OTHER, buttons, deferred, input, press, textOf } from './publishDepthTestHelpers';
const mockRequest = jest.fn(), mockApi = { request: mockRequest };
jest.mock('../src/lib/usePublishApi', () => ({ usePublishApi: () => mockApi }));
jest.mock('expo-router', () => ({ Stack: { Screen: () => null } }));
jest.mock('../src/lib/appCache', () => ({ getCacheUser: () => 'u', subscribeCacheUser: () => () => {} }));
void [RN.Pressable, RN.TextInput, RN.Text, RN.View, RN.ScrollView, RN.StyleSheet, RN.ActivityIndicator, RN.RefreshControl];
let root: Root, alert: jest.SpyInstance, role: string;
const team = (actor_role = role, brand_name = 'Current team') => ({ brand_id: brandStore.get(), brand_name, actor_role,
    members: [{ user_id: ID, email: 'member@example.com', role: 'editor' }],
    invitations: [{ id: ID, email: 'manager@example.com', role: 'manager', status: 'pending' }, { id: OTHER, email: 'editor@example.com', role: 'editor', status: 'pending' }],
});
beforeEach(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true; brandStore.set(ID); jest.clearAllMocks(); mockRequest.mockReset(); root = createRoot(); role = 'owner';
    alert = jest.spyOn(RN.Alert, 'alert').mockImplementation(() => {}); mockRequest.mockImplementation(async () => team());
});
afterEach(async () => { await act(async () => root.unmount()); alert.mockRestore(); brandStore.set(null); });
const render = async () => { await act(async () => root.render(<TeamScreen />)); };
const writes = () => mockRequest.mock.calls.filter(([, init]) => init?.method && init.method !== 'GET');
const revoke = (email: string) => t('team.revokeLabel', { email });
const confirm = () => alert.mock.calls.at(-1)![2].find((b: any) => b.onPress).onPress;
const refresh = async () => { await act(async () => { const control = root.container.queryAll(n => n.props.refreshControl?.props.onRefresh)[0]; control.props.refreshControl.props.onRefresh(); }); };
test('manager cannot revoke a manager invitation', async () => {
    role = 'manager'; await render(); expect(buttons(root, revoke('manager@example.com'))).toHaveLength(0);
});
test('manager can revoke an editor invitation', async () => {
    role = 'manager'; await render(); await press(root, revoke('editor@example.com')); await act(async () => confirm()());
    expect(writes()).toHaveLength(1); expect(writes()[0][1].method).toBe('DELETE');
});
test('owner can revoke both', async () => { await render(); for (const email of ['manager@example.com', 'editor@example.com']) expect(buttons(root, revoke(email))).toHaveLength(1); });
test('held team read from brand A is dropped after switch to B', async () => {
    const old = deferred<unknown>(); mockRequest.mockImplementation(() => brandStore.get() === ID ? old.promise : Promise.resolve(team('manager', 'Brand B')));
    await render(); await act(async () => brandStore.set(OTHER)); await act(async () => old.resolve(team('owner', 'Brand A')));
    expect(textOf(root.container)).toContain('Brand B'); expect(textOf(root.container)).not.toContain('Brand A'); expect(buttons(root, 'Manager')).toHaveLength(0);
});
test('invite link is cleared on brand change', async () => {
    await render(); await input(root, t('team.inviteEmail'), 'guest@example.com');
    mockRequest.mockImplementation(async (_path, init) => init?.method === 'POST' ? { invitation: { id: ID, email: 'guest@example.com', role: 'editor', url: 'https://veyrnox.ai/social/team/invite/opaque' } } : team());
    await press(root, t('team.inviteAction')); await act(async () => confirm()()); expect(buttons(root, t('team.shareInvite'))).toHaveLength(1);
    await act(async () => brandStore.set(OTHER)); expect(buttons(root, t('team.shareInvite'))).toHaveLength(0);
});
test("owner's manager choice is not sent after switching to a brand where the actor is manager", async () => {
    await render(); await press(root, 'Manager'); role = 'manager'; await act(async () => brandStore.set(OTHER));
    expect(buttons(root, 'Manager')).toHaveLength(0); await input(root, t('team.inviteEmail'), 'guest@example.com'); await press(root, t('team.inviteAction')); await act(async () => confirm()());
    expect(writes()).toHaveLength(1); expect(JSON.parse(writes()[0][1].body).role).toBe('editor');
});
test('newer team read wins over an older one in the same brand', async () => {
    await render(); const old = deferred<unknown>(), newer = deferred<unknown>(); mockRequest.mockImplementationOnce(() => old.promise).mockImplementationOnce(() => newer.promise);
    await refresh(); await refresh(); await act(async () => newer.resolve(team('manager', 'New team'))); await act(async () => old.resolve(team('owner', 'Old team')));
    expect(textOf(root.container)).toContain('New team'); expect(textOf(root.container)).not.toContain('Old team'); expect(buttons(root, 'Manager')).toHaveLength(0);
});
test.each(['revoke', 'remove', 'role', 'invite'])('old %s confirmation sends nothing after scope change', async action => {
    await render();
    if (action === 'revoke') await press(root, revoke('editor@example.com'));
    if (action === 'remove' || action === 'role') {
        await press(root, t('team.change'));
        if (action === 'remove') await press(root, t('team.removeAction'));
        else { const choices = buttons(root, 'Viewer'); await act(async () => choices[0].props.onClick({ nativeEvent: {} })); }
    }
    if (action === 'invite') { await input(root, t('team.inviteEmail'), 'guest@example.com'); await press(root, t('team.inviteAction')); }
    const onPress = confirm(); await act(async () => { brandStore.set(OTHER); brandStore.set(ID); }); await act(async () => onPress()); expect(writes()).toHaveLength(0);
});
test('invite confirmation rechecks the actor after a same-brand role downgrade', async () => {
    await render(); await press(root, 'Manager'); await input(root, t('team.inviteEmail'), 'guest@example.com'); await press(root, t('team.inviteAction')); const onPress = confirm();
    role = 'manager'; await refresh(); await act(async () => onPress()); expect(writes()).toHaveLength(0);
});
