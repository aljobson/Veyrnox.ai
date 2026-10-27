import { act } from 'react';
import * as RN from 'react-native';
import { createRoot, type Root } from 'test-renderer';
import JobScreen from '../src/app/(app)/job/[id]';
import { claimReviewAsk, resetReviewAskClaim } from '../src/lib/reviewAsk';
const mockPush = jest.fn(),
    mockAsset = jest.fn(),
    mockCelebrate = jest.fn();
const mockApi = { request: jest.fn() };
let mockWaited = true;
let mockRefocus: (() => void) | undefined;
let mockBlur: (() => void) | undefined;
jest.mock('../src/auth/AuthProvider', () => ({ useAuth: () => ({ api: mockApi }) }));
jest.mock('expo-router', () => ({
    Stack: { Screen: () => null },
    Link: () => null,
    useLocalSearchParams: () => ({ id: 'job-id' }),
    useRouter: () => ({ replace: jest.fn(), push: mockPush }),
    useFocusEffect: (fn: () => () => void) =>
        require('react').useEffect(() => {
            mockRefocus = () => { mockBlur = fn(); };
            mockRefocus();
            return mockBlur;
        }, [fn]),
}));
jest.mock('expo-image', () => ({ Image: jest.requireActual('react-native').Image }));
jest.mock('expo-web-browser', () => ({ openBrowserAsync: jest.fn() }));
jest.mock('../src/components/JobProvenance', () => ({ JobProvenance: () => null }));
jest.mock('../src/components/StemList', () => ({ StemList: () => null }));
jest.mock('../src/lib/output', () => ({ saveOutput: jest.fn(), shareOutput: jest.fn() }));
jest.mock('../src/lib/storeReview', () => ({ loadReviewAsk: async () => null }));
jest.mock('../src/lib/celebrate', () => ({ ...jest.requireActual('../src/lib/celebrate'), celebrateOutput: (...args: unknown[]) => mockCelebrate(...args) }));
jest.mock('../src/lib/media', () => ({
    mediaApi: () => ({ getAsset: mockAsset, getJob: async () => ({ state: 'succeeded', model_id: 'm' }) }),
    waitForJob: async (_: unknown, __: string, update: (s: string) => void) => {
        if (mockWaited) update('running');
        update('succeeded');
        return 'succeeded';
    },
}));
void [RN.View, RN.Text, RN.Pressable, RN.ScrollView, RN.Image];
let root: Root;
beforeEach(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    root = createRoot();
    jest.useFakeTimers();
    jest.clearAllMocks();
    resetReviewAskClaim();
    mockWaited = true;
    mockAsset.mockResolvedValue({ url: 'https://example.test/result.png', mime_type: 'image/png' });
    mockCelebrate.mockReturnValue({ big: false, done: Promise.resolve() });
});
afterEach(async () => {
    await act(async () => root.unmount());
    jest.useRealTimers();
});
async function render() {
    await act(async () => root.render(<JobScreen />));
}
test('inaccessible output fires nothing and consumes no rating claim', async () => {
    mockAsset.mockRejectedValue(Error('no access'));
    await render();
    expect(mockCelebrate).not.toHaveBeenCalled();
    await act(async () => jest.advanceTimersByTime(5000));
    expect(mockPush).not.toHaveBeenCalled();
});
test('a historical first poll carries no unfinished evidence and never asks for a rating', async () => {
    mockWaited = false;
    await render();
    expect(mockCelebrate).toHaveBeenCalledWith('job-id', 'image/png', false);
    await act(async () => jest.advanceTimersByTime(5000));
    expect(mockPush).not.toHaveBeenCalled();
});
test('rating is pushed only after the celebration promise resolves', async () => {
    let done!: () => void;
    mockCelebrate.mockReturnValue({
        big: true,
        done: new Promise<void>((resolve) => {
            done = resolve;
        }),
    });
    await render();
    expect(mockCelebrate).toHaveBeenCalledWith('job-id', 'image/png', true);
    await act(async () => jest.advanceTimersByTime(5000));
    expect(mockPush).not.toHaveBeenCalled();
    await act(async () => done());
    expect(mockPush).toHaveBeenCalledWith('/rate');
    expect(claimReviewAsk()).toBe(false);
});
test.each(['unmount', 'blur'])('no delayed rating after %s', async (how) => {
    await render();
    if (how === 'unmount') await act(async () => root.unmount());
    else await act(async () => mockBlur?.());
    await act(async () => jest.advanceTimersByTime(5000));
    expect(mockPush).not.toHaveBeenCalled();
});

test.each(['unmount', 'blur'])('%s during celebration leaves the rating ask unclaimed', async (how) => {
    let done!: () => void;
    mockCelebrate.mockReturnValue({ big: true, done: new Promise<void>((resolve) => { done = resolve; }) });
    await render();
    if (how === 'unmount') await act(async () => root.unmount());
    else await act(async () => mockBlur?.());
    await act(async () => done());
    expect(mockPush).not.toHaveBeenCalled();
    expect(claimReviewAsk()).toBe(true);
});
test('refocusing does not restart the job poll or output fetch', async () => {
    await render();
    expect(mockAsset).toHaveBeenCalledTimes(1);
    await act(async () => mockBlur?.());
    await act(async () => mockRefocus?.());
    expect(mockAsset).toHaveBeenCalledTimes(1);
    expect(mockCelebrate).toHaveBeenCalledTimes(1);
    await act(async () => jest.advanceTimersByTime(5000));
    expect(mockPush).not.toHaveBeenCalled();
});
