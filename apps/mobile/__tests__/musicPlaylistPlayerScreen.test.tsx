import { act } from 'react';
import { createRoot, type Root } from 'test-renderer';
import * as RN from 'react-native';
import { PlaylistPlayer } from '../src/components/music/PlaylistPlayer';
import { playlist, songId } from './fixtures/musicPlaylists';
import { song, JOB } from './fixtures/music';
import { t } from '../src/lib/i18n';
const mockApi = { request: jest.fn() };
const mockPort = { isLoaded: true, play: jest.fn(), pause: jest.fn(), seekTo: jest.fn(async () => {}), remove: jest.fn(), addListener: jest.fn(() => ({ remove: jest.fn() })) };
jest.mock('../src/auth/AuthProvider', () => ({ useAuth: () => ({ api: mockApi }) }));
jest.mock('expo-router', () => ({ useFocusEffect: (cb: () => void) => require('react').useEffect(cb, [cb]) }));
jest.mock('expo-audio', () => ({ createAudioPlayer: () => mockPort, setAudioModeAsync: async () => {} }));
void [RN.View, RN.Text, RN.Pressable];
let root: Root, listeners: ((s: RN.AppStateStatus) => void)[];
const button = (label: string) => root.container.queryAll(n => n.props.accessibilityRole === 'button' && n.props.accessibilityLabel === label)[0];
const click = async (label: string) => { await act(async () => button(label).props.onClick({ nativeEvent: {} })); };
beforeEach(() => {
    jest.clearAllMocks(); (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true; RN.AppState.currentState = 'active';
    listeners = [];
    jest.spyOn(RN.AppState, 'addEventListener').mockImplementation((_event, callback) => { listeners.push(callback); return { remove: jest.fn() }; });
    mockApi.request.mockImplementation(async (path: string) => path.endsWith('/asset') ? { url: 'https://signed.test/audio', mime_type: 'audio/wav' }
        : path.endsWith('/library-tabs') ? { recorded: true } : { ...song, id: path.split('/').at(-1) });
    root = createRoot();
});
afterEach(async () => { await act(async () => root.unmount()); jest.restoreAllMocks(); });
test('Play all uses authenticated assets; non-active pauses and Play resumes the current track', async () => {
    await act(async () => root.render(<PlaylistPlayer playlist={playlist} />)); await click(t('musicPlaylists.playAll'));
    expect(mockApi.request).toHaveBeenCalledWith(`/api/v1/music/songs/${songId}`);
    expect(mockApi.request).toHaveBeenCalledWith(`/api/v1/jobs/${JOB}/asset`);
    expect(mockPort.play).toHaveBeenCalledTimes(1); const pauses = mockPort.pause.mock.calls.length;
    await act(async () => { RN.AppState.currentState = 'inactive'; listeners.forEach(cb => cb('inactive')); });
    expect(mockPort.pause.mock.calls.length).toBeGreaterThan(pauses); expect(button(t('music.play'))).toBeDefined();
    await click(t('music.play')); expect(mockPort.play).toHaveBeenCalledTimes(1);
    expect(root.container.queryAll(n => n.props.accessibilityRole === 'alert' && n.children.includes(t('musicPlaylists.startRefused')))).toHaveLength(1);
    await act(async () => { RN.AppState.currentState = 'active'; listeners.forEach(cb => cb('active')); });
    await click(t('music.play')); expect(mockPort.play).toHaveBeenCalledTimes(2);
    await click(t('music.pause')); expect(button(t('music.play'))).toBeDefined(); expect(mockPort.seekTo).toHaveBeenCalledTimes(1);
    await act(async () => root.unmount()); expect(mockPort.remove).toHaveBeenCalled();
});
test('pin and refresh with identical ordered member ids preserve the playing controller', async () => {
    await act(async () => root.render(<PlaylistPlayer playlist={playlist} />)); await click(t('musicPlaylists.playAll'));
    const pauses = mockPort.pause.mock.calls.length, subscriptions = listeners.length;
    for (const pinned of [true, false]) {
        await act(async () => root.render(<PlaylistPlayer playlist={{ ...playlist, pinned, revision: playlist.revision + 1,
            songs: playlist.songs.map(s => ({ ...s, title: `${s.title} updated` })) }} />));
        expect(mockPort.remove).not.toHaveBeenCalled(); expect(mockPort.pause).toHaveBeenCalledTimes(pauses);
        expect(listeners).toHaveLength(subscriptions); expect(button(t('music.pause'))).toBeDefined();
    }
    expect(mockPort.play).toHaveBeenCalledTimes(1);
});
test.each(['order', 'membership', 'id'])('a changed playlist %s stops and resets playback', async change => {
    await act(async () => root.render(<PlaylistPlayer playlist={playlist} />)); await click(t('musicPlaylists.playAll'));
    const next = change === 'id' ? { ...playlist, id: songId } : { ...playlist,
        songs: change === 'order' ? [...playlist.songs].reverse() : playlist.songs.slice(1) };
    await act(async () => root.render(<PlaylistPlayer playlist={next} />));
    expect(mockPort.remove).toHaveBeenCalledTimes(1); expect(button(t('music.pause'))).toBeUndefined(); expect(button(t('music.play'))).toBeUndefined();
});
test('refused initial start shows feedback and re-reads active state on retry', async () => {
    RN.AppState.currentState = 'inactive';
    await act(async () => root.render(<PlaylistPlayer playlist={playlist} />)); await click(t('musicPlaylists.playAll'));
    expect(mockApi.request).not.toHaveBeenCalled();
    expect(root.container.queryAll(n => n.children.includes(t('musicPlaylists.startRefused'))).length).toBeGreaterThan(0);
    RN.AppState.currentState = 'active'; await click(t('musicPlaylists.playAll')); expect(mockPort.play).toHaveBeenCalledTimes(1);
});
