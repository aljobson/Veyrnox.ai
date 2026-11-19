import { act } from 'react';
import { createRoot } from 'test-renderer';
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
test('Play all uses authenticated song assets and non-active app state pauses the existing controller', async () => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true; RN.AppState.currentState = 'active';
    const listeners: ((s: RN.AppStateStatus) => void)[] = [];
    jest.spyOn(RN.AppState, 'addEventListener').mockImplementation((_event, callback) => { listeners.push(callback); return { remove: jest.fn() }; });
    mockApi.request.mockImplementation(async (path: string) => path.endsWith('/asset') ? { url: 'https://signed.test/audio', mime_type: 'audio/wav' }
        : path.endsWith('/library-tabs') ? { recorded: true } : { ...song, id: songId });
    const root = createRoot(); await act(async () => root.render(<PlaylistPlayer playlist={playlist} />));
    const play = root.container.queryAll(n => n.props.accessibilityRole === 'button' && n.props.accessibilityLabel === t('musicPlaylists.playAll'))[0];
    await act(async () => play.props.onClick({ nativeEvent: {} }));
    expect(mockApi.request).toHaveBeenCalledWith(`/api/v1/music/songs/${songId}`);
    expect(mockApi.request).toHaveBeenCalledWith(`/api/v1/jobs/${JOB}/asset`);
    expect(mockPort.play).toHaveBeenCalledTimes(1); const pauses = mockPort.pause.mock.calls.length;
    await act(async () => listeners.forEach(cb => cb('inactive'))); expect(mockPort.pause.mock.calls.length).toBeGreaterThan(pauses);
    await act(async () => root.unmount()); expect(mockPort.remove).toHaveBeenCalled(); jest.restoreAllMocks();
});
