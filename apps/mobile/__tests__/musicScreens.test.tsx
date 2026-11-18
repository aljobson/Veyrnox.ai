import { bindCacheUser, resetCacheUser } from '../src/lib/appCache';
import * as musicPlayer from '../src/lib/music/player';
import { act } from 'react';
import { createRoot, type Root } from 'test-renderer';
import * as RN from 'react-native';
import MusicLibrary from '../src/app/(app)/music';
import SongDetail from '../src/app/(app)/music/[id]';
import { useMusicAvailable } from '../src/lib/music/useMusicAvailable';
import { ApiError } from '../src/lib/api';
import { t } from '../src/lib/i18n';
import { song, trashedRow, hook } from './fixtures/music';
const mockApi = { request: jest.fn() };
const mockPush = jest.fn();
let mockParams = { id: 's1', revision: '2' };
jest.mock('../src/auth/AuthProvider', () => ({ useAuth: () => ({ api: mockApi }) }));
jest.mock('expo-router', () => ({ Link: ({ children }: { children: unknown }) => children, Stack: { Screen: () => null }, useRouter: () => ({ push: mockPush }),
    useLocalSearchParams: () => mockParams, useFocusEffect: (cb: () => void) => require('react').useEffect(cb, [cb]) }));
jest.mock('../src/components/music/MusicPlayer', () => ({ MusicPlayer: () => require('react').createElement(require('react-native').View, { testID: 'music-player' }) }));
jest.mock('../src/components/music/MusicShares', () => ({ MusicShares: () => require('react').createElement(require('react-native').View, { testID: 'music-shares' }) }));
// Decorative native animation is outside these navigation/lifecycle assertions.
jest.mock('../src/components/VeyCharacter', () => ({ VeyCharacter: () => null }));
void [RN.View, RN.ScrollView, RN.Pressable, RN.Text];
let root: Root;
const text = (value: string) => root.container.queryAll(n => n.children.includes(value));
const button = (value: string) => root.container.queryAll(n => n.props.accessibilityRole === 'button' && n.props.accessibilityLabel === value)[0];
const click = async (value: string) => { await act(async () => button(value).props.onClick({ nativeEvent: {} })); };
const search = async (query: string) => {
    const input = root.container.queryAll(n => n.props.accessibilityLabel === t('music.search') && typeof n.props.onChangeText === 'function')[0];
    await act(async () => input.props.onChangeText(query));
    await click(t('music.search'));
};
const baseResponse = async (path: string) => {
    if (path.includes('library-tabs')) throw new ApiError(404, 'music_library_tabs_unavailable');
    if (path === '/api/v1/music/songs/s1') return song;
    return { songs: [{ id: 's1', title: 'A song', revision: 2 }] };
};
beforeEach(async () => {
    resetCacheUser(); await bindCacheUser('music-user');
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true; root = createRoot(); mockParams = { id: 's1', revision: '2' };
    jest.clearAllMocks(); mockApi.request.mockImplementation(baseResponse);
});
afterEach(async () => { await act(async () => root.unmount()); jest.restoreAllMocks(); });
test('Songs off shows empty state; hidden tabs and no player', async () => {
    mockApi.request.mockRejectedValue(new ApiError(404, 'music_unavailable'));
    await act(async () => root.render(<MusicLibrary />));
    expect(text(t('music.off')).length).toBeGreaterThan(0);
    expect(root.container.queryAll(n => n.props.testID === 'music-player')).toHaveLength(0);
    expect(root.container.queryAll(n => n.props.accessibilityRole === 'tab')).toHaveLength(0);
});
test('unsupported applied search hides search, explains fallback, and preserves row navigation', async () => {
    mockApi.request.mockImplementation(async (path: string) => {
        if (path.includes('&q=')) throw new ApiError(404, 'music_library_unavailable');
        return baseResponse(path);
    });
    await act(async () => root.render(<MusicLibrary />));
    expect(mockApi.request).toHaveBeenCalledWith('/api/v1/music/songs?limit=50');
    expect(mockApi.request.mock.calls.some(([path]) => path.includes('&q='))).toBe(false);
    await search('night music');
    expect(mockApi.request).toHaveBeenCalledWith('/api/v1/music/songs?limit=50&q=night+music');
    expect(text(t('music.searchUnavailable', { query: 'night music' })).length).toBeGreaterThan(0);
    expect(text(t('music.off'))).toHaveLength(0); expect(text(t('music.search'))).toHaveLength(0);
    await click(t('music.openNamed', { title: 'A song' }));
    expect(mockPush).toHaveBeenCalledWith({ pathname: '/music/[id]', params: { id: 's1', revision: '2' } });
    expect(root.container.queryAll(n => n.props.testID === 'music-player')).toHaveLength(0);
});
test('trash keeps banner and uses retained revision to restore without GET while trashed', async () => {
    const alert = jest.spyOn(RN.Alert, 'alert').mockImplementation(() => {});
    let trashed = false;
    mockApi.request.mockImplementation(async (path: string, init?: RequestInit) => {
        if (init?.method === 'PATCH') {
            const body = JSON.parse(init.body as string); trashed = body.action === 'trash';
            return { song: { ...trashedRow, revision: trashed ? 3 : 4, lifecycle_status: trashed ? 'trashed' : 'active' }, idempotent: false };
        }
        if (trashed && path === '/api/v1/music/songs/s1') throw new Error('must not read trashed detail');
        return baseResponse(path);
    });
    await act(async () => root.render(<SongDetail />)); await click(t('music.trash'));
    await act(async () => { alert.mock.calls[0][2]![1].onPress!(); });
    expect(text(t('music.trashBanner')).length).toBeGreaterThan(0);
    expect(root.container.queryAll(n => n.props.testID === 'music-player')).toHaveLength(0);
    expect(mockApi.request.mock.calls.filter(([path, init]) => path === '/api/v1/music/songs/s1' && !init)).toHaveLength(1);
    await click(t('music.restore'));
    const bodies = mockApi.request.mock.calls.filter(([, init]) => init?.method === 'PATCH').map(([, init]) => JSON.parse(init.body));
    expect(bodies).toEqual([{ action: 'trash', revision: 2 }, { action: 'restore', revision: 3 }]);
    expect(text(t('music.restored')).length).toBeGreaterThan(0);
});
test('detail without numeric revision hides trash; sharing requires its action', async () => {
    mockParams = { id: 's1', revision: '' };
    mockApi.request.mockImplementation(async (path: string) => path === '/api/v1/music/songs/s1' ? { ...song, actions: [] } : { songs: [] });
    await act(async () => root.render(<SongDetail />));
    expect(button(t('music.trash'))).toBeUndefined();
    expect(root.container.queryAll(n => n.props.testID === 'music-shares')).toHaveLength(0);
});
function Entry() { return <RN.Text>{useMusicAvailable() ? 'available' : 'hidden'}</RN.Text>; }
test.each([new ApiError(404, 'music_unavailable'), new ApiError(500, 'internal')])('entry stays hidden on %p', async error => {
    mockApi.request.mockRejectedValue(error); await act(async () => root.render(<Entry />));
    expect(text('available')).toHaveLength(0);
});
test('entry hidden during probe and appears only after on', async () => {
    let finish!: (value: unknown) => void; mockApi.request.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    await act(async () => root.render(<Entry />)); expect(text('available')).toHaveLength(0);
    await act(async () => finish({ songs: [] })); expect(text('available').length).toBeGreaterThan(0);
    expect(mockApi.request).toHaveBeenCalledWith('/api/v1/music/songs?limit=1');
});

test('Songs starts before optional tab probes settle', async () => {
    mockApi.request.mockImplementation((path: string) => path.includes('library-tabs') ? new Promise(() => {}) : baseResponse(path));
    await act(async () => root.render(<MusicLibrary />));
    expect(mockApi.request.mock.calls[0][0]).toBe('/api/v1/music/songs?limit=50');
    expect(mockApi.request.mock.calls.some(([path]) => path.includes('&q='))).toBe(false);
});
test('a failed search retains its term and does not request unfiltered songs', async () => {
    await act(async () => root.render(<MusicLibrary />)); mockApi.request.mockClear();
    mockApi.request.mockImplementation(async (path: string) => {
        if (path.includes('&q=')) throw new ApiError(500, 'internal');
        return baseResponse(path);
    });
    await search('night');
    expect(mockApi.request).toHaveBeenCalledWith('/api/v1/music/songs?limit=50&q=night');
    expect(mockApi.request).not.toHaveBeenCalledWith('/api/v1/music/songs?limit=50');
    expect(root.container.queryAll(n => n.props.value === 'night').length).toBeGreaterThan(0);
    expect(text(t('music.loadError')).length).toBeGreaterThan(0);
});

test('trashed detail with a non-null audio URL shows trash controls without rendering a player', async () => {
    mockApi.request.mockImplementation(async (path: string) => path === '/api/v1/music/songs/s1'
        ? { ...song, lifecycle_status: 'trashed' } : { songs: [] });
    await act(async () => root.render(<SongDetail />));
    expect(text(t('music.trashBanner')).length).toBeGreaterThan(0);
    expect(button(t('music.restore'))).toBeDefined(); expect(button(t('music.trash'))).toBeUndefined();
    expect(root.container.queryAll(n => n.props.testID === 'music-player')).toHaveLength(0);
});
test('an unexpected playback adapter failure renders the existing player notice', async () => {
    jest.spyOn(musicPlayer, 'songPlayback').mockImplementation(() => { throw new Error('invalid playback'); });
    await act(async () => root.render(<SongDetail />));
    expect(text(t('music.player.error')).length).toBeGreaterThan(0);
    expect(root.container.queryAll(n => n.props.testID === 'music-player')).toHaveLength(0);
});
test.each([true, false])('Hooks shows partial notice for dropped rows (valid row: %p)', async includeGood => {
    mockApi.request.mockImplementation(async (path: string) => path.endsWith('tab=hooks')
        ? { hooks: [{ ...hook, id: 'bad', end_seconds: 0 }, ...(includeGood ? [hook] : [])] } : baseResponse(path));
    await act(async () => root.render(<MusicLibrary />));
    const tab = root.container.queryAll(n => n.props.accessibilityRole === 'tab' && n.props.accessibilityLabel === t('music.tab.hooks'))[0];
    await act(async () => tab.props.onClick({ nativeEvent: {} }));
    expect(text(t('music.partial')).length).toBeGreaterThan(0);
    expect(text(t('music.empty.hooks'))).toHaveLength(0);
    expect(root.container.queryAll(n => n.props.accessibilityLabel === t('music.playNamed', { title: hook.title })).length).toBe(includeGood ? 1 : 0);
});
const remountEntry = async () => {
    await act(async () => root.unmount()); root = createRoot();
    await act(async () => root.render(<Entry />));
};
test('second mount immediately shows cached availability while probing; errors preserve it and off clears it', async () => {
    await act(async () => root.render(<Entry />)); expect(text('available').length).toBeGreaterThan(0);
    let reject!: (error: unknown) => void;
    mockApi.request.mockImplementation(() => new Promise((_, fail) => { reject = fail; }));
    await remountEntry(); expect(text('available').length).toBeGreaterThan(0);
    await act(async () => reject(new ApiError(500, 'internal'))); expect(text('available').length).toBeGreaterThan(0);
    await remountEntry(); expect(text('available').length).toBeGreaterThan(0);
    await act(async () => reject(new ApiError(404, 'music_unavailable'))); expect(text('available')).toHaveLength(0);
    await remountEntry(); expect(text('available')).toHaveLength(0);
});
test('account switch hides cached availability and ignores the previous account probe', async () => {
    await act(async () => root.render(<Entry />));
    let finishOld!: (value: unknown) => void;
    mockApi.request.mockImplementationOnce(() => new Promise(resolve => { finishOld = resolve; }));
    await remountEntry(); expect(text('available').length).toBeGreaterThan(0);
    mockApi.request.mockImplementation(() => new Promise(() => {}));
    await act(async () => bindCacheUser('another-user')); expect(text('available')).toHaveLength(0);
    await act(async () => finishOld({ songs: [] })); expect(text('available')).toHaveLength(0);
});
test('sign-out clears availability even between mounts, including a same-account sign-in', async () => {
    await act(async () => root.render(<Entry />)); expect(text('available').length).toBeGreaterThan(0);
    await act(async () => root.unmount()); root = createRoot();
    resetCacheUser(); await bindCacheUser('music-user');
    mockApi.request.mockImplementation(() => new Promise(() => {}));
    await act(async () => root.render(<Entry />)); expect(text('available')).toHaveLength(0);
});
