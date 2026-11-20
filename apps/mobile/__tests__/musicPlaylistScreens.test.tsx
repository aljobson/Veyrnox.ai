import { act } from 'react';
import { createRoot, type Root } from 'test-renderer';
import * as RN from 'react-native';
import Playlists from '../src/app/(app)/music/playlists';
import PlaylistDetail from '../src/app/(app)/music/playlists/[id]';
import Discover from '../src/app/(app)/music/discover';
import MusicCreate from '../src/app/(app)/music/create';
import MusicLibrary from '../src/app/(app)/music';
import { ApiError } from '../src/lib/api';
import { bindCacheUser, resetCacheUser } from '../src/lib/appCache';
import { plural, t } from '../src/lib/i18n';
import { DISCOVER_SEEDS, buildSamplePrompt } from '../src/lib/music/discoverSeeds';
import { playlist, created, playlistId, songId, secondId, deferred } from './fixtures/musicPlaylists';
import { entitlements } from './fixtures/musicCreate';
const mockApi = { request: jest.fn() }, mockPush = jest.fn();
let mockFocused = true;
const mockFocusListeners = new Set<(focused: boolean) => void>();
let mockParams: { id?: string; sample?: string } = { id: playlistId };
jest.mock('../src/auth/AuthProvider', () => ({ useAuth: () => ({ api: mockApi }) }));
jest.mock('expo-router', () => ({ Link: ({ children }: { children: unknown }) => children, Stack: { Screen: () => null }, useRouter: () => ({ push: mockPush }),
    useLocalSearchParams: () => mockParams, useFocusEffect: (cb: () => void | (() => void)) => require('react').useEffect(() => {
        let cleanup: void | (() => void);
        const change = (focused: boolean) => { cleanup?.(); cleanup = focused ? cb() : undefined; };
        mockFocusListeners.add(change); change(mockFocused);
        return () => { cleanup?.(); mockFocusListeners.delete(change); };
    }, [cb]) }));
jest.mock('../src/components/music/PlaylistPlayer', () => ({ PlaylistPlayer: ({ playlist: p }: { playlist: unknown }) => require('react').createElement(require('react-native').View, { testID: 'playlist-player', playlist: p }) }));
jest.mock('expo-crypto', () => ({ randomUUID: () => jest.requireActual('node:crypto').randomUUID() }));
jest.mock('../src/components/music/MusicPlayer', () => ({ MusicPlayer: () => null }));
jest.mock('../src/components/VeyCharacter', () => ({ VeyCharacter: () => null }));
void [RN.View, RN.ScrollView, RN.Text, RN.Pressable];
let root: Root;
const text = (s: string) => root.container.queryAll(n => n.children.includes(s));
const button = (s: string) => root.container.queryAll(n => n.props.accessibilityRole === 'button' && n.props.accessibilityLabel === s)[0];
const click = async (s: string) => { await act(async () => button(s).props.onClick({ nativeEvent: {} })); };
const field = (s: string) => root.container.queryAll(n => n.props.accessibilityLabel === s && typeof n.props.onChangeText === 'function')[0];
const edit = async (label: string, value: string) => { await act(async () => field(label).props.onChangeText(value)); };
const mount = async (component: React.ReactElement) => { await act(async () => root.render(component)); };
beforeEach(async () => {
    mockFocused = true; resetCacheUser(); await bindCacheUser('p4-screen-user'); jest.clearAllMocks(); mockParams = { id: playlistId };
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true; root = createRoot();
    mockApi.request.mockImplementation(async (path: string) => path.endsWith('/entitlements') ? entitlements : { playlists: [playlist] });
});
afterEach(async () => { await act(async () => { root.unmount(); resetCacheUser(); }); jest.restoreAllMocks(); });
test('list loading, empty create, and authoritative creation after lost acknowledgement', async () => {
    const wait = deferred<unknown>(); mockApi.request.mockReturnValueOnce(wait.promise); await mount(<Playlists />);
    expect(text(t('music.loading')).length).toBeGreaterThan(0);
    await act(async () => wait.resolve({ playlists: [] })); expect(text(t('musicPlaylists.empty')).length).toBeGreaterThan(0);
    await edit(t('musicPlaylists.name'), 'Evening'); mockApi.request.mockRejectedValueOnce(new Error('offline'));
    await click(t('musicPlaylists.create')); expect(field(t('musicPlaylists.name')).props.editable).toBe(false);
    mockApi.request.mockResolvedValueOnce({ playlist: created }).mockResolvedValueOnce({ playlists: [{ ...playlist, title: 'Authoritative' }] });
    await click(t('music.retry')); expect(text('Authoritative').length).toBeGreaterThan(0);
    const bodies = mockApi.request.mock.calls.filter(([, init]) => init?.method === 'POST').map(([, init]) => JSON.parse(init.body));
    expect(bodies).toHaveLength(2); expect(bodies[0]).toEqual(bodies[1]);
});
test.each([new ApiError(404, 'playlists_unavailable'), new Error('offline')])('list shows off/error and retry for %p', async error => {
    mockApi.request.mockRejectedValue(error); await mount(<Playlists />);
    expect(text(t(error instanceof ApiError ? 'music.off' : 'musicPlaylists.offline')).length).toBeGreaterThan(0);
    if (!(error instanceof ApiError)) { mockApi.request.mockResolvedValueOnce({ playlists: [] }); await click(t('music.retry')); expect(text(t('musicPlaylists.empty')).length).toBeGreaterThan(0); }
});
test('title validation is inline and invalid titles never submit', async () => {
    await mount(<Playlists />); await click(t('musicPlaylists.create'));
    expect(text(t('musicPlaylists.titleInvalid')).length).toBeGreaterThan(0);
    expect(mockApi.request.mock.calls.filter(([, init]) => init)).toHaveLength(0);
    expect(field(t('musicPlaylists.name')).props.maxLength).toBe(80);
});
test('detail reorder, remove, add, pin each send immediately using the latest read revision', async () => {
    let current = playlist;
    const extra = '66666666-6666-4666-8666-666666666666';
    mockApi.request.mockImplementation(async (path: string, init?: RequestInit) => {
        if (init?.method === 'PATCH') {
            const b = JSON.parse(init.body as string);
            current = { ...current, revision: current.revision + 1, ...(b.action === 'pin' ? { pinned: b.pinned } : {
                songs: b.song_ids.map((id: string, i: number) => ({ ...(playlist.songs.find(s => s.id === id) ?? { ...playlist.songs[0], id, title: 'Extra' }), position: i + 1 })),
            }) }; return { revision: current.revision, idempotent: false };
        }
        if (path.includes('/songs?')) return { songs: [{ id: songId, title: 'First' }, { id: extra, title: 'Extra' }] };
        return { playlists: [current] };
    });
    await mount(<PlaylistDetail />);
    await click(t('musicPlaylists.down', { title: 'First' }));
    await click(t('musicPlaylists.remove', { title: 'Second' }));
    await click(t('musicPlaylists.add')); expect(button(t('musicPlaylists.addNamed', { title: 'First' }))).toBeUndefined();
    await click(t('musicPlaylists.addNamed', { title: 'Extra' })); await click(t('musicPlaylists.pin'));
    const bodies = mockApi.request.mock.calls.filter(([, init]) => init?.method === 'PATCH').map(([, init]) => JSON.parse(init.body));
    expect(bodies.map(({ idempotency_key, ...body }) => body)).toEqual([
        { action: 'replace', expected_revision: 3, song_ids: [secondId, songId] },
        { action: 'replace', expected_revision: 4, song_ids: [songId] },
        { action: 'replace', expected_revision: 5, song_ids: [songId, extra] },
        { action: 'pin', expected_revision: 6, pinned: true },
    ]);
    expect(new Set(bodies.map(b => b.idempotency_key)).size).toBe(4);
    expect(root.container.queryAll(n => n.props.testID === 'playlist-player')[0].props.playlist.revision).toBe(7);
});
test('conflict reloads and shows redo instruction; in-flight double taps send once', async () => {
    await mount(<PlaylistDetail />); const wait = deferred<unknown>(); mockApi.request.mockReturnValueOnce(wait.promise);
    const pin = button(t('musicPlaylists.pin'));
    await act(async () => { pin.props.onClick({ nativeEvent: {} }); pin.props.onClick({ nativeEvent: {} }); });
    expect(mockApi.request.mock.calls.filter(([, init]) => init)).toHaveLength(1);
    mockApi.request.mockResolvedValueOnce({ playlists: [{ ...playlist, revision: 8 }] });
    await act(async () => wait.reject(new ApiError(409, 'revision_conflict', { revision: 8 })));
    expect(text(t('musicPlaylists.conflict')).length).toBeGreaterThan(0);
    expect(root.container.queryAll(n => n.props.testID === 'playlist-player')[0].props.playlist.revision).toBe(8);
});
test('account change discards old lists and ignores late write success', async () => {
    await mount(<PlaylistDetail />); const wait = deferred<unknown>(); mockApi.request.mockReturnValueOnce(wait.promise);
    await click(t('musicPlaylists.pin')); mockApi.request.mockResolvedValue({ playlists: [] });
    await act(async () => bindCacheUser('other-account')); await act(async () => wait.resolve({ revision: 4, idempotent: false }));
    expect(text('First')).toHaveLength(0); expect(text(t('musicPlaylists.saved'))).toHaveLength(0);
});
test('Discover filters without network and routes the selected sample to Create', async () => {
    await mount(<Discover />); expect(mockApi.request).not.toHaveBeenCalled();
    const tab = root.container.queryAll(n => n.props.accessibilityRole === 'tab' && n.props.accessibilityLabel === t('musicDiscover.mood.Jazz'))[0];
    await act(async () => tab.props.onClick({ nativeEvent: {} })); expect(text('Neon Rain')).toHaveLength(0);
    await click(t('musicDiscover.use', { title: 'Glass Horizon' }));
    expect(mockPush).toHaveBeenCalledWith({ pathname: '/music/create', params: { sample: 'glass-horizon' } });
});
test('valid sample prefills untouched Create without a paid request', async () => {
    mockParams = { sample: 'neon-rain' }; await mount(<MusicCreate />);
    expect(field(t('music.create.prompt')).props.value).toBe(buildSamplePrompt(DISCOVER_SEEDS[0]));
    expect(field(t('music.create.songTitle')).props.value).toBe('Neon Rain');
    expect(mockApi.request.mock.calls.every(([path]) => path.endsWith('/entitlements'))).toBe(true);
});
test('sample arriving after typed text never overwrites it, even if cleared', async () => {
    mockParams = {}; await mount(<MusicCreate />); await edit(t('music.create.prompt'), 'My idea'); await edit(t('music.create.prompt'), '');
    mockParams = { sample: 'neon-rain' }; await mount(<MusicCreate />);
    expect(field(t('music.create.prompt')).props.value).toBe('');
});
test('invalid sample does not prefill', async () => {
    mockParams = { sample: 'not-a-listed-sample' }; await mount(<MusicCreate />); expect(field(t('music.create.prompt')).props.value).toBe('');
});
test('Music entry rows appear only when the songs probe is on and navigate natively', async () => {
    mockApi.request.mockImplementation(async (path: string) => path.includes('library-tabs') ? Promise.reject(new ApiError(404, 'music_library_tabs_unavailable')) : { songs: [] });
    await mount(<MusicLibrary />); await click(t('musicPlaylists.title')); await click(t('musicDiscover.title')); await click(t('musicPublic.explore'));
    expect(mockPush.mock.calls).toEqual([['/music/playlists'], ['/music/discover'], ['/music/explore']]);
    await act(async () => root.unmount()); root = createRoot(); mockApi.request.mockRejectedValue(new ApiError(404, 'music_unavailable'));
    await mount(<MusicLibrary />); expect(button(t('musicPlaylists.title'))).toBeUndefined(); expect(button(t('musicDiscover.title'))).toBeUndefined();
});

const focus = async (focused: boolean) => {
    await act(async () => { mockFocused = focused; mockFocusListeners.forEach(change => change(focused)); });
};
test('pending create survives navigation and refocus and can only replay its original title/key', async () => {
    const accepted = { ...playlist, title: 'Evening' };
    let posts = 0;
    mockApi.request.mockImplementation(async (_path: string, init?: RequestInit) => {
        if (init?.method === 'POST') {
            if (++posts === 1) throw new Error('response lost after server accepted');
            return { playlist: created };
        }
        return { playlists: [accepted] };
    });
    await mount(<Playlists />); await edit(t('musicPlaylists.name'), 'Evening');
    await click(t('musicPlaylists.create'));
    await click('Evening'); expect(mockPush).toHaveBeenCalledWith({ pathname: '/music/playlists/[id]', params: { id: playlistId } });
    await focus(false); await focus(true); await focus(false); await focus(true);
    expect(posts).toBe(1);
    expect(field(t('musicPlaylists.name')).props.value).toBe('Evening');
    expect(field(t('musicPlaylists.name')).props.editable).toBe(false);
    expect(button(t('musicPlaylists.create'))).toBeUndefined();
    const retry = button(t('music.retry'));
    await act(async () => { retry.props.onClick({ nativeEvent: {} }); retry.props.onClick({ nativeEvent: {} }); });
    const bodies = mockApi.request.mock.calls.filter(([, init]) => init?.method === 'POST').map(([, init]) => JSON.parse(init.body));
    expect(bodies).toHaveLength(2); expect(bodies[0]).toEqual(bodies[1]);
    expect(bodies[0].title).toBe('Evening');
    expect(field(t('musicPlaylists.name')).props.value).toBe('');
    expect(field(t('musicPlaylists.name')).props.editable).toBe(true);
    expect(root.container.queryAll(n => n.props.accessibilityRole === 'button' && n.props.accessibilityLabel === 'Evening')).toHaveLength(1);
});
test('create draft survives same-account refocus but clears on account change', async () => {
    await mount(<Playlists />); await edit(t('musicPlaylists.name'), 'Keep my draft');
    await focus(false); await focus(true);
    expect(field(t('musicPlaylists.name')).props.value).toBe('Keep my draft');
    await act(async () => bindCacheUser('different-user'));
    expect(field(t('musicPlaylists.name')).props.value).toBe('');
    expect(text(t('musicPlaylists.pending'))).toHaveLength(0);
    await click(t('musicPlaylists.create'));
    expect(mockApi.request.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(0);
});
test('account change while blurred cancels a pending create and ignores its late result', async () => {
    await mount(<Playlists />); await edit(t('musicPlaylists.name'), 'Evening');
    const wait = deferred<unknown>(); mockApi.request.mockReturnValueOnce(wait.promise);
    await click(t('musicPlaylists.create')); await focus(false);
    mockApi.request.mockResolvedValue({ playlists: [] });
    await act(async () => bindCacheUser('different-user'));
    await act(async () => wait.resolve({ playlist: created })); await focus(true);
    expect(text(t('musicPlaylists.saved'))).toHaveLength(0);
    expect(field(t('musicPlaylists.name')).props.editable).toBe(true);
    expect(field(t('musicPlaylists.name')).props.value).toBe('');
    expect(button(t('musicPlaylists.create'))).toBeDefined();
    expect(text(t('musicPlaylists.pending'))).toHaveLength(0);
    await click(t('musicPlaylists.create'));
    expect(mockApi.request.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(1);
});

test.each(['account change', 'sign-out'])('%s clears draft validation', async change => {
    await mount(<Playlists />); await edit(t('musicPlaylists.name'), '   ');
    await click(t('musicPlaylists.create'));
    expect(text(t('musicPlaylists.titleInvalid')).length).toBeGreaterThan(0);
    await act(async () => { if (change === 'account change') await bindCacheUser('different-user'); else resetCacheUser(); });
    expect(field(t('musicPlaylists.name')).props.value).toBe('');
    expect(text(t('musicPlaylists.titleInvalid'))).toHaveLength(0);
});

test('detail cleanup uses the singular label and loses its scan on blur', async () => {
    await mount(<PlaylistDetail />);
    mockApi.request.mockRejectedValueOnce(new ApiError(404, 'not_found'))
        .mockRejectedValueOnce(new ApiError(404, 'not_found'));
    await click(t('musicPlaylists.checkUnavailable'));
    expect(button(plural('musicPlaylists.removeUnavailable', 2))).toBeDefined();
    await focus(false); expect(button(plural('musicPlaylists.removeUnavailable', 2))).toBeUndefined();
    await focus(true);
    mockApi.request.mockRejectedValueOnce(new ApiError(404, 'not_found'))
        .mockResolvedValueOnce({ ...jest.requireActual('./fixtures/music').song, id: secondId });
    await click(t('musicPlaylists.checkUnavailable'));
    expect(button(plural('musicPlaylists.removeUnavailable', 1))).toBeDefined();
    expect(button(plural('musicPlaylists.removeUnavailable', 2))).toBeUndefined();
});
