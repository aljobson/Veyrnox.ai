import { act } from 'react';
import { createRoot, type Root } from 'test-renderer';
import * as RN from 'react-native';
import { MusicPlayer } from '../src/components/music/MusicPlayer';
import { bindCacheUser, resetCacheUser } from '../src/lib/appCache';
import { t } from '../src/lib/i18n';
import { trackAudio, trackStart } from './fixtures/musicTrackAdd';
import { SONG_ID, deferred } from './fixtures/musicActions';
const mockApi = { request: jest.fn() };
const mockPort = { isLoaded: true, play: jest.fn(), pause: jest.fn(), seekTo: jest.fn(async () => {}), remove: jest.fn(),
    addListener: jest.fn(() => ({ remove: jest.fn() })) };
const mockFactory = jest.fn((..._args: unknown[]) => mockPort), mockMode = jest.fn(async (..._args: unknown[]) => {});
jest.mock('expo-audio', () => ({ createAudioPlayer: (...args: unknown[]) => mockFactory(...args), setAudioModeAsync: (...args: unknown[]) => mockMode(...args) }), { virtual: true });
jest.mock('../src/components/VeyLoader', () => ({ VeyLoader: () => null }));
jest.mock('../src/auth/AuthProvider', () => ({ useAuth: () => ({ api: mockApi }) }));
jest.mock('expo-router', () => ({ useFocusEffect: (effect: () => void | (() => void)) => require('react').useEffect(effect, [effect]) }));
void [RN.View, RN.Text, RN.Pressable];
const input = { songId: SONG_ID, jobId: trackStart.track_job_id, trackAddRequestId: trackStart.request_id, start: 0 };
let root: Root;
const click = async (label: string) => act(async () => {
    const button = root.container.queryAll(n => n.props.accessibilityRole === 'button' && n.props.accessibilityLabel === label)[0];
    button.props.onClick({ nativeEvent: {} });
});
beforeEach(async () => {
    RN.AppState.currentState = 'active'; resetCacheUser(); await bindCacheUser('track-playback-user'); jest.clearAllMocks();
    mockApi.request.mockResolvedValue(trackAudio);
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true; root = createRoot();
    await act(async () => root.render(<MusicPlayer input={input} />));
});
afterEach(async () => { await act(async () => { root.unmount(); resetCacheUser(); }); });
test('real player hook waits for Play and requests fresh part audio on every explicit start', async () => {
    expect(mockApi.request).not.toHaveBeenCalled(); expect(mockFactory).not.toHaveBeenCalled();
    await click(t('music.play'));
    expect(mockApi.request).toHaveBeenCalledWith(`/api/v1/music/track-add-requests/${trackStart.request_id}/audio`, {}, { timeoutMs: 15000 });
    expect(mockFactory).toHaveBeenLastCalledWith({ uri: trackAudio.url }, { updateInterval: 100 }); expect(mockPort.play).toHaveBeenCalledTimes(1);
    await click(t('music.pause')); mockApi.request.mockResolvedValueOnce({ ...trackAudio, url: 'https://mock.test/new-part.mp3' });
    await click(t('music.play')); expect(mockApi.request).toHaveBeenCalledTimes(2);
    expect(mockFactory).toHaveBeenLastCalledWith({ uri: 'https://mock.test/new-part.mp3' }, { updateInterval: 100 });
    expect(mockPort.remove).toHaveBeenCalledTimes(1); expect(mockPort.play).toHaveBeenCalledTimes(2);
});
test.each(['unmount', 'account'] as const)('%s ignores a late audio URL and prevents native playback', async reason => {
    const wait = deferred<typeof trackAudio>(); mockApi.request.mockImplementationOnce(() => wait.promise);
    await click(t('music.play')); expect(mockApi.request).toHaveBeenCalledTimes(1);
    await act(async () => { if (reason === 'unmount') root.render(<></>); else await bindCacheUser('other-user'); });
    await act(async () => wait.resolve(trackAudio)); expect(mockFactory).not.toHaveBeenCalled(); expect(mockPort.play).not.toHaveBeenCalled();
});
test('invalid audio shows quiet retry copy and does not reach the native factory', async () => {
    mockApi.request.mockResolvedValueOnce({ ...trackAudio, url: 'http://mock.test/part.mp3' }); await click(t('music.play'));
    expect(mockFactory).not.toHaveBeenCalled();
    expect(root.container.queryAll(n => n.children.includes(t('music.player.error')))).toHaveLength(1);
    expect(root.container.queryAll(n => n.children.includes('bad_response'))).toHaveLength(0);
});
