import { act, createElement } from 'react';
import * as RN from 'react-native';
import { createRoot, type Root } from 'test-renderer';
import { CheckInModal } from '../src/components/CheckInModal';
import { CheckInEntry } from '../src/components/credits/CheckInEntry';
import { announceCheckin, peekCheckin, requestCheckinOpen } from '../src/lib/checkinEntry';
import { appStorage, bindCacheUser, getCacheUser, wipeCache } from '../src/lib/appCache';
import { setFirstRunPending } from '../src/lib/firstRunPending';
const mockRequest = jest.fn();
const mockApi = { request: mockRequest };
jest.mock('../src/auth/AuthProvider', () => ({ useAuth: () => ({ api: mockApi, status: 'signedIn' }) }));
void [RN.Modal, RN.ScrollView, RN.Text, RN.Pressable];
const status = { ok: true as const, claimed_today: false, streak: 0, next_day: 1, next_credits: 1, rewards: [1,1,2,2,2,3] };
let root: Root, serial = 0;
// ADR-0271: the check-in dialog waits for the first-run analytics choice; these tests start after it.
beforeEach(async () => { (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true; setFirstRunPending(false); mockRequest.mockReset(); await wipeCache(); await bindCacheUser(`entry-${++serial}`); root = createRoot(); });
afterEach(async () => { await act(async () => root.unmount()); await wipeCache(); });
test.each([false, true])('reopens a dismissed or claimed dialog without another GET (claimed=%s)', async claimed => {
    mockRequest.mockResolvedValue({ ...status, claimed_today: claimed });
    await appStorage.set(`checkin.${getCacheUser()}`, new Date().toISOString().slice(0,10));
    await act(async () => root.render(createElement(CheckInModal)));
    expect(root.container.queryAll(n => n.children.includes('Earn Credits by Checking In'))).toHaveLength(0);
    await act(async () => requestCheckinOpen());
    expect(root.container.queryAll(n => n.children.includes('Earn Credits by Checking In')).length).toBeGreaterThan(0);
    expect(mockRequest).toHaveBeenCalledTimes(1);
    if (claimed) expect(root.container.queryAll(n => n.children.includes('Claimed today')).length).toBeGreaterThan(0);
});
test('entry hides for null, hides claimed on Home, and clears on account change', async () => {
    await act(async () => root.render(createElement(CheckInEntry)));
    expect(root.container.queryAll(n => n.props.accessibilityRole === 'button')).toHaveLength(0);
    await act(async () => announceCheckin(getCacheUser()!, status));
    expect(root.container.queryAll(n => n.props.accessibilityRole === 'button')).toHaveLength(1);
    await act(async () => { announceCheckin(getCacheUser()!, { ...status, claimed_today: true }); root.render(createElement(CheckInEntry, { unclaimedOnly: true })); });
    expect(root.container.queryAll(n => n.props.accessibilityRole === 'button')).toHaveLength(0);
    const old = getCacheUser(); await act(async () => bindCacheUser('another-viewer'));
    expect(peekCheckin(old)).toBeNull(); expect(peekCheckin(getCacheUser())).toBeNull();
});
