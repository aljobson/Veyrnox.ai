import { act, createElement } from 'react';
import * as ReactNative from 'react-native';
import { createRoot, type Root } from 'test-renderer';
import { CheckInModal } from '../src/components/CheckInModal';
import { ApiError } from '../src/lib/api';
import { appStorage, bindCacheUser, getCacheUser, wipeCache } from '../src/lib/appCache';

const mockRequest = jest.fn();
const mockApi = { request: mockRequest, getBalance: async () => ({ balance: 11, free_credits: 10, free_expires_at: null }) };
jest.mock('../src/auth/AuthProvider', () => ({ useAuth: () => ({ api: mockApi, status: 'signedIn' }) }));
void [ReactNative.Modal, ReactNative.ScrollView, ReactNative.Text, ReactNative.Pressable];
const status = { ok: true, claimed_today: false, streak: 0, next_day: 1, next_credits: 1, rewards: [1,1,2,2,2,3] };
let root: Root;
let serial = 0;
const has = (text: string) => root.container.queryAll(n => n.children.includes(text)).length > 0;
async function press(label: string) {
    const controls = root.container.queryAll(n => n.props.accessibilityRole === 'button' && n.props.accessibilityLabel === label);
    expect(controls).toHaveLength(1);
    await act(async () => { controls[0].props.onClick({ nativeEvent: {}, currentTarget: 1, target: 1 }); });
}
async function mount() { await act(async () => root.render(createElement(CheckInModal))); }
beforeEach(async () => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    mockRequest.mockReset(); mockRequest.mockResolvedValue(status);
    await wipeCache(); await bindCacheUser(`checkin-modal-${++serial}`);
    root = createRoot();
});
afterEach(async () => { await act(async () => root.unmount()); await wipeCache(); });
test('flag off renders no invitation', async () => {
    mockRequest.mockRejectedValue(new ApiError(404, 'not_found'));
    await mount(); expect(has('Earn Credits by Checking In')).toBe(false);
});
test('already-claimed status renders no invitation', async () => {
    mockRequest.mockResolvedValue({ ...status, claimed_today: true, streak: 1 });
    await mount(); expect(has('Earn Credits by Checking In')).toBe(false);
    expect(mockRequest).toHaveBeenCalledTimes(1);
});
test('dismissal is remembered for this viewer and UTC date', async () => {
    await mount(); expect(has('Earn Credits by Checking In')).toBe(true);
    expect(has('Day 6+')).toBe(true);
    await press('Close');
    expect(await appStorage.get(`checkin.${getCacheUser()}`)).toBe(new Date().toISOString().slice(0,10));
    await act(async () => root.unmount()); root = createRoot();
    await mount(); expect(has('Earn Credits by Checking In')).toBe(false);
});
test('BUSY permits a retry; a successful claim shows the earned amount', async () => {
    await mount();
    mockRequest.mockRejectedValueOnce(new ApiError(409, 'checkin_busy'));
    await press('Check in'); expect(has('Please try again in a moment.')).toBe(true);
    mockRequest.mockResolvedValueOnce({ ok: true, already_claimed: false, streak: 1, day: 1, credits: 1, balance_after: 11 });
    await press('Check in'); expect(has('You earned 1 credit.')).toBe(true);
    expect(has('Claimed today')).toBe(true);
    expect(root.container.queryAll(n => n.props.accessibilityLabel === 'Claimed today' && n.children.includes('✓'))).toHaveLength(1);
});
test('a previous UTC day dismissal does not suppress the next invitation', async () => {
    await appStorage.set(`checkin.${getCacheUser()}`, new Date(Date.now()-86400000).toISOString().slice(0,10));
    await mount(); expect(has('Earn Credits by Checking In')).toBe(true);
});

test.each([403, 404])('status %s does not poll or refetch on remount for this UTC day', async code => {
    jest.useFakeTimers();
    try {
        mockRequest.mockRejectedValue(new ApiError(code, code === 403 ? 'account_unavailable' : 'not_found'));
        await mount();
        await act(async () => { jest.advanceTimersByTime(30 * 60_000); });
        expect(mockRequest).toHaveBeenCalledTimes(1);
        await act(async () => root.unmount()); root = createRoot();
        await mount(); expect(mockRequest).toHaveBeenCalledTimes(1);
        expect(has('Earn Credits by Checking In')).toBe(false);
    } finally { jest.useRealTimers(); }
});
test('account_unavailable on claim hides the modal and suppresses further status reads', async () => {
    await mount();
    mockRequest.mockRejectedValueOnce(new ApiError(403, 'account_unavailable'));
    await press('Check in'); expect(has('Earn Credits by Checking In')).toBe(false);
    await act(async () => root.unmount()); root = createRoot();
    await mount(); expect(mockRequest).toHaveBeenCalledTimes(2);
});
