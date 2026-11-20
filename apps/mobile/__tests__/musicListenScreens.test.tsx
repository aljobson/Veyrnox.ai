import { act } from 'react';
import { createRoot, type Root } from 'test-renderer';
import * as RN from 'react-native';
import { createAudioPlayer } from 'expo-audio';
import Listen from '../src/app/music/listen/[token]';
import { ApiError } from '../src/lib/api';
import { getSharedSong } from '../src/lib/music/sharedListenClient';
import { bindCacheUser, resetCacheUser } from '../src/lib/appCache';
import { t } from '../src/lib/i18n';
import { shared, token, deferred } from './fixtures/musicPublication';
const mockReplace = jest.fn(), mockLog = jest.fn(), mockPersist = jest.fn();
const mockNative = { isLoaded: true, play: jest.fn(), pause: jest.fn(), remove: jest.fn(), seekTo: jest.fn(async () => {}), addListener: jest.fn(() => ({ remove: jest.fn() })) };
jest.mock('expo-audio', () => ({ createAudioPlayer: jest.fn(() => mockNative), setAudioModeAsync: jest.fn(async () => {}) }));
jest.mock('../src/lib/music/sharedListenClient', () => ({ getSharedSong: jest.fn() }));
jest.mock('../src/auth/AuthProvider', () => ({ useAuth: () => { throw new Error('Listen must not read identity'); } }));
jest.mock('../src/lib/analytics/events', () => ({ captureEvent: (...args: unknown[]) => mockLog(...args) }));
jest.mock('../src/lib/crash', () => ({ captureIssue: (...args: unknown[]) => mockLog(...args) }));
jest.mock('expo-secure-store', () => ({ getItem: () => null, setItem: (...args: unknown[]) => mockPersist(...args), setItemAsync: (...args: unknown[]) => mockPersist(...args) }));
jest.mock('expo-router', () => ({ useLocalSearchParams: () => ({ token: jest.requireActual('./fixtures/musicPublication').token }), useRouter: () => ({ replace: mockReplace }),
    useFocusEffect: (cb: () => void | (() => void)) => jest.requireActual('react').useEffect(cb, [cb]) }));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
void [RN.View, RN.ScrollView, RN.Text, RN.Pressable];
let root: Root, state: RN.AppStateStatus = 'active', onApp: (state: RN.AppStateStatus) => void;
const text = (value: string) => root.container.queryAll(n => n.children.includes(value));
const buttons = (key: string) => root.container.queryAll(n => n.props.accessibilityRole === 'button' && n.props.accessibilityLabel === t(key));
const click = async (key: string) => { await act(async () => buttons(key)[0].props.onClick({ nativeEvent: {} })); };
const mount = async () => { await act(async () => root.render(<Listen />)); };
beforeEach(async () => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true; resetCacheUser(); await bindCacheUser('listen-a'); jest.clearAllMocks();
    state = 'active'; Object.defineProperty(RN.AppState, 'currentState', { configurable: true, get: () => state });
    jest.spyOn(RN.AppState, 'addEventListener').mockImplementation((_type, cb) => { onApp = cb; return { remove: jest.fn() }; });
    jest.mocked(getSharedSong).mockResolvedValue(shared.song); root = createRoot();
});
afterEach(async () => { await act(async () => { root.unmount(); resetCacheUser(); }); jest.restoreAllMocks(); });
test('anonymous screen loads then plays, pauses and closes natively', async () => {
    const late = deferred<typeof shared.song>(); jest.mocked(getSharedSong).mockReturnValueOnce(late.promise); await mount();
    expect(text(t('music.loading')).length).toBeGreaterThan(0); expect(buttons('music.play')).toHaveLength(0);
    await act(async () => late.resolve(shared.song)); expect(text(shared.song.title)).toHaveLength(1);
    await click('music.play'); expect(mockNative.play).toHaveBeenCalledTimes(1); expect(buttons('music.pause')).toHaveLength(1);
    expect(createAudioPlayer).toHaveBeenCalledWith({ uri: expect.stringContaining(shared.song.audio_url) }, { updateInterval: 100, downloadFirst: false });
    await click('music.pause'); expect(mockNative.pause).toHaveBeenCalled(); await click('common.close'); expect(mockReplace).toHaveBeenCalledWith('/');
});
test('not_found is a dead link, never a rollout-off state or sign-in', async () => {
    jest.mocked(getSharedSong).mockRejectedValueOnce(new ApiError(404, 'not_found')); await mount();
    expect(text(t('musicPublication.linkGone')).length).toBeGreaterThan(0); expect(buttons('music.play')).toHaveLength(0); expect(mockReplace).not.toHaveBeenCalled();
});
test('inactive during audio read prevents a late play', async () => {
    await mount(); const late = deferred<typeof shared.song>(); jest.mocked(getSharedSong).mockReturnValueOnce(late.promise);
    await click('music.play'); await act(async () => { state = 'inactive'; onApp(state); late.resolve(shared.song); });
    expect(mockNative.play).not.toHaveBeenCalled(); expect(createAudioPlayer).not.toHaveBeenCalled();
});
test('account change cancels old screen request and playback and discards late content', async () => {
    const late = deferred<typeof shared.song>(); jest.mocked(getSharedSong).mockReturnValueOnce(late.promise); await mount();
    const signal = jest.mocked(getSharedSong).mock.calls[0][1]!;
    await act(async () => bindCacheUser('listen-b')); expect(signal.aborted).toBe(true);
    await act(async () => late.resolve({ ...shared.song, title: 'Stale account result' }));
    expect(text('Stale account result')).toHaveLength(0); await click('music.play');
    await act(async () => bindCacheUser('listen-c')); expect(mockNative.remove).toHaveBeenCalled(); expect(mockReplace).not.toHaveBeenCalled();
});
test('token never reaches console, telemetry, persistence, or navigation beyond route params', async () => {
    const spies = ['log', 'warn', 'error', 'info', 'debug'].map(key => jest.spyOn(console, key as 'log').mockImplementation(() => {}));
    await mount(); await click('music.play'); await click('common.close');
    const output = JSON.stringify([mockLog.mock.calls, mockPersist.mock.calls, mockReplace.mock.calls, ...spies.map(spy => spy.mock.calls)]);
    expect(output).not.toContain(token); expect(mockPersist).not.toHaveBeenCalled();
});

test('load errors offer retry without revealing secret errors or inventing a report action', async () => {
    jest.mocked(getSharedSong).mockRejectedValueOnce(new Error(`transport /listen/${token}`)); await mount();
    expect(text(t('music.loadError')).length).toBeGreaterThan(0);
    expect(root.container.queryAll(n => n.props.accessibilityLabel === t('musicPublic.reportTrack'))).toHaveLength(0);
    expect(text(`transport /listen/${token}`)).toHaveLength(0); await click('music.retry'); expect(text(shared.song.title)).toHaveLength(1);
});
test('leaving during initial load aborts the request and ignores its late answer', async () => {
    const late = deferred<typeof shared.song>(); jest.mocked(getSharedSong).mockReturnValueOnce(late.promise); await mount();
    const signal = jest.mocked(getSharedSong).mock.calls[0][1]!; await act(async () => root.unmount());
    expect(signal.aborted).toBe(true); await act(async () => late.resolve(shared.song));
    expect(createAudioPlayer).not.toHaveBeenCalled(); expect(mockReplace).not.toHaveBeenCalled();
});
