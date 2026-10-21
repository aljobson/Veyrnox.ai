import { act, useState } from 'react';
import { createRoot, type Root, type TestInstance } from 'test-renderer';
import * as WebBrowser from 'expo-web-browser';
import { DiscoveryList } from '../src/components/cinema/DiscoveryList';
import EditorialScreen from '../src/app/(app)/cinema/series/[slug]';
import TitleScreen from '../src/app/(app)/cinema/[id]';
import Watch from '../src/app/(app)/cinema/watch/[id]';
import { EDITORIAL_SERIES } from '../src/lib/cinemaEditorialData';
import { fetchDiscovery } from '../src/lib/cinemaBrowse';
import { parseTitle } from '../src/lib/cinema';
import { ApiError } from '../src/lib/api';

declare const require: { (id: string): any; resolve(id: string): string };
jest.setTimeout(30000);
const mockRequest = jest.fn();
const mockAuth = { api: { request: mockRequest }, getAccessToken: jest.fn() };
const mockRouter = { push: jest.fn(), dismissTo: jest.fn(), replace: jest.fn(), back: jest.fn() };
const mockGetState = jest.fn(() => ({ routes: [] as any[] }));
let mockParams: Record<string, string> = {};
let mockFocused = true;
let mockPage = 0;
const mockSave = jest.fn(async () => undefined);
const mockPlayer = {
    currentTime: 0, playing: false, keepScreenOnWhilePlaying: false,
    replaceAsync: jest.fn(async () => undefined),
    play: jest.fn(() => { mockPlayer.playing = true; mockPlaying?.({ isPlaying: true }); }),
    pause: jest.fn(() => { mockPlayer.playing = false; }),
    addListener: jest.fn((name: string, cb: any) => { if (name === 'playingChange') mockPlaying = cb; return { remove: jest.fn() }; }),
};
let mockPlaying: ((event: { isPlaying: boolean }) => void) | undefined;
jest.mock('expo-router', () => {
    const React = jest.requireActual('react');
    const RouteContext = React.createContext(null);
    return {
        __RouteContext: RouteContext,
        Stack: { Screen: ({ options }: any) => options.headerRight?.() ?? null },
        Link: 'Link', useRouter: () => mockRouter,
        useNavigation: () => ({ getState: mockGetState }),
        useLocalSearchParams: () => React.useContext(RouteContext)?.params ?? mockParams,
        useFocusEffect: (effect: () => void | (() => void)) => {
            const focused = React.useContext(RouteContext)?.focused ?? mockFocused;
            React.useEffect(() => focused ? effect() : undefined, [effect, focused]);
        },
    };
});
jest.mock('expo-image', () => ({ Image: jest.requireActual('react-native').Image }));
jest.mock('expo-web-browser', () => ({ openBrowserAsync: jest.fn() }));
jest.mock('expo-crypto', () => ({ randomUUID: () => 'test-key' }));
jest.mock('expo-video', () => ({ useVideoPlayer: () => mockPlayer, VideoView: 'VideoView' }));
jest.mock('../src/auth/AuthProvider', () => ({ useAuth: () => mockAuth }));
jest.mock('../src/components/cinema/SaveFollow', () => ({ SaveFollow: () => null }));
jest.mock('../src/components/cinema/VotePolls', () => ({ VotePolls: () => null }));
jest.mock('../src/lib/cinemaBrowse', () => ({ ...jest.requireActual('../src/lib/cinemaBrowse'), fetchDiscovery: jest.fn() }));
jest.mock('../src/lib/cinemaProgress', () => ({ getCinemaProgress: () => ({ recorder: () => mockSave }) }));
// Render the entire list so order and duplicate rows are observable independently of native virtualization.
jest.mock('react-native', () => {
    const rn = jest.requireActual('react-native');
    return Object.defineProperty(Object.create(rn), 'FlatList', { value: ({ data, renderItem, keyExtractor, onEndReached, ListFooterComponent }: any) => {
        const React = jest.requireActual('react');
        return React.createElement('FlatList', { onEndReached }, data.map((item: any, index: number) =>
            React.createElement(React.Fragment, { key: keyExtractor(item) }, renderItem({ item, index }))), ListFooterComponent);
    } });
});
// Resolve native lazy getters before individual interaction timeouts start.
const native = jest.requireActual('react-native');
void [native.ActivityIndicator, native.Image, native.Pressable, native.ScrollView, native.StyleSheet, native.Text, native.View];
const seriesId = 'abcdefab-1111-4111-8111-111111111111';
const path = require('path');
const appLayoutDirectory = path.dirname(require.resolve('../src/app/(app)/_layout.tsx'));
const routeName = (file: string): string => path.relative(appLayoutDirectory, require.resolve(file)).replace(/\.tsx$/, '').split(path.sep).join('/');
const seriesRoute = routeName('../src/app/(app)/cinema/[id].tsx');
const watchRoute = routeName('../src/app/(app)/cinema/watch/[id].tsx');
const ids = ['22222222-2222-4222-8222-222222222222', '33333333-3333-4333-8333-333333333333', '44444444-4444-4444-8444-444444444444'];
const detail = { title: { id: seriesId, content_type: 'SERIES', title: 'Database series', access: 'free', seasons: [{ position: 1, episodes: [
    { id: ids[0], title: 'Free episode', position: 1, duration_seconds: 125, access: 'free' },
    { id: ids[1], title: 'Exhausted episode', position: 2, duration_seconds: 125, access: 'free' },
    { id: ids[2], title: 'Paid episode', position: 3, duration_seconds: 125, access: 'locked', credits: 6 },
] }] } };
let root: Root;
beforeEach(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    jest.clearAllMocks();
    mockRouter.push.mockReset(); mockRouter.dismissTo.mockReset(); mockRouter.replace.mockReset();
    mockGetState.mockReturnValue({ routes: [] });
    mockParams = {}; mockFocused = true; mockPage = 0;
    mockPlayer.currentTime = 0; mockPlayer.playing = false; mockPlaying = undefined;
    jest.mocked(WebBrowser.openBrowserAsync).mockResolvedValue({ type: 'dismiss' } as any);
    jest.mocked(fetchDiscovery).mockResolvedValue({ kind: 'closed' });
    mockRequest.mockImplementation(async (path: string) => {
        if (path.includes('/titles/')) return detail;
        if (path.includes('entitlement')) {
            if (path.endsWith(ids[1])) return { access: 'locked', reason: 'free_ceiling', credits: 0 };
            if (path.endsWith(ids[2])) throw new ApiError(503, 'unlocks_not_open');
            return { access: 'free', credits: 0 };
        }
        if (path === '/api/v1/cinema/play') return { token: 'head.body.sig', customer_code: 'abc', expires_at: new Date(Date.now() + 900000).toISOString(), watch_session_id: seriesId };
        return {};
    });
    root = createRoot();
});
afterEach(async () => { await act(async () => root.unmount()); jest.useRealTimers(); });
const render = async (element: React.ReactElement) => { await act(async () => root.render(element)); };
const nodes = (role: string) => root.container.queryAll(n => n.props.accessibilityRole === role);
const textOf = (n: TestInstance): string => n.children.map(c => typeof c === 'string' ? c : textOf(c)).join('');
const allText = () => textOf(root.container);
async function press(node: TestInstance) { await act(async () => node.props.onClick({ nativeEvent: {}, currentTarget: 1, target: 1 })); }
const button = (text: string) => nodes('button').find(n => textOf(n).includes(text))!;

test('series discovery orders editorial before database, routes correctly and does not repeat on page two', async () => {
    const db = { ...parseTitle(detail.title)!, competitions: [] };
    jest.mocked(fetchDiscovery).mockResolvedValueOnce({ kind: 'ok', page: { titles: [db], next: { at: 'date', id: seriesId } } })
        .mockResolvedValueOnce({ kind: 'ok', page: { titles: [{ ...db, id: ids[0], title: 'Page two' }], next: null } });
    await render(<DiscoveryList mode="series" category={null} />);
    expect(nodes('button').map(n => n.props.accessibilityLabel.split('.')[0])).toEqual([...EDITORIAL_SERIES.map(s => s.title), 'Database series']);
    await press(nodes('button')[0]);
    expect(mockRouter.push).toHaveBeenCalledWith({ pathname: '/cinema/series/[slug]', params: { slug: EDITORIAL_SERIES[0].slug } });
    await act(async () => root.container.queryAll(n => n.type === 'FlatList')[0].props.onEndReached());
    expect(nodes('button').map(n => n.props.accessibilityLabel.split('.')[0])).toEqual([...EDITORIAL_SERIES.map(s => s.title), 'Database series', 'Page two']);
});
test.each(['closed', 'error'] as const)('editorial rows survive first-page %s without failure copy', async kind => {
    jest.mocked(fetchDiscovery).mockResolvedValue({ kind });
    await render(<DiscoveryList mode="series" category={null} />);
    expect(nodes('button')).toHaveLength(EDITORIAL_SERIES.length);
    expect(allText()).not.toMatch(/not open|retry/i);
});
test('closed category without editorial matches and voting keep existing copy', async () => {
    await render(<DiscoveryList mode="series" category="comedy" />);
    expect(allText()).toContain('Social Cinema viewing is not open yet.');
    await render(<DiscoveryList key="voting" mode="voting" category={null} />);
    expect(allText()).toContain('Community voting is not open yet.');
    expect(nodes('button')).toHaveLength(0);
});
test('error without editorial matches retains retry, and an empty result retains empty copy', async () => {
    jest.mocked(fetchDiscovery).mockResolvedValueOnce({ kind: 'error' });
    await render(<DiscoveryList mode="series" category="comedy" />);
    expect(allText()).toContain('Could not load Cinema. Tap to retry.');
    jest.mocked(fetchDiscovery).mockResolvedValueOnce({ kind: 'ok', page: { titles: [], next: null } });
    await press(nodes('button')[0]);
    expect(allText()).toContain('No series to show yet. Check back soon.');
});
test('editorial screen orders accessible episodes, opens exact URL and hides browser exception', async () => {
    const s = EDITORIAL_SERIES[0]; mockParams = { slug: s.slug };
    await render(<EditorialScreen />);
    expect(nodes('header').map(textOf)).toEqual([s.title, 'Episodes']);
    const episodes = nodes('link').filter(n => n.props.accessibilityLabel?.startsWith('Watch episode'));
    expect(episodes.map(n => n.props.accessibilityLabel)).toEqual(s.episodes.map(e => `Watch episode ${e.position}: ${e.title}. Opens veyrnox.ai`));
    await press(episodes[1]);
    expect(WebBrowser.openBrowserAsync).toHaveBeenLastCalledWith(`https://veyrnox.ai/social-cinema/watch/${s.episodes[1].id}?series=${s.slug}`);
    jest.mocked(WebBrowser.openBrowserAsync).mockRejectedValueOnce(new Error('private exception'));
    await press(episodes[1]);
    expect(allText()).toContain('Could not open veyrnox.ai. Try again.');
    expect(nodes('alert')).toHaveLength(1);
    expect(allText()).not.toContain('private exception');
    expect(mockRequest).not.toHaveBeenCalled(); expect(fetchDiscovery).not.toHaveBeenCalled();
});
test('unknown editorial slug is quiet and makes no reads or browser call', async () => {
    mockParams = { slug: 'constructor' }; await render(<EditorialScreen />);
    expect(allText()).toContain('This series is not available.');
    expect(nodes('link')).toHaveLength(1);
    expect(mockRequest).not.toHaveBeenCalled(); expect(fetchDiscovery).not.toHaveBeenCalled(); expect(WebBrowser.openBrowserAsync).not.toHaveBeenCalled();
});
test('database rows use metered entitlement even for free detail, preserve paid labels without prices and pass parent', async () => {
    mockParams = { id: seriesId }; await render(<TitleScreen />);
    expect(textOf(button('Free episode'))).toContain('2:05');
    expect(textOf(button('Exhausted episode'))).toContain('Free viewing used this month');
    expect(button('Exhausted episode').props.accessibilityState.disabled).toBe(true);
    expect(textOf(button('Paid episode'))).toContain('Paid title, not in the app yet');
    expect(textOf(button('Paid episode'))).not.toContain('6');
    for (const id of ids.slice(0, 2)) expect(mockRequest).toHaveBeenCalledWith(`/api/v1/cinema/entitlement?content_id=${id}`);
    expect(mockRequest).not.toHaveBeenCalledWith(`/api/v1/cinema/entitlement?content_id=${ids[2]}`);
    await press(button('Free episode'));
    expect(mockRouter.push).toHaveBeenCalledWith({ pathname: '/cinema/watch/[id]', params: { id: ids[0], title: 'Free episode', series: seriesId } });
});
test('entitlement reads skip detail locks and run sequentially in episode order', async () => {
    const thirdFree = '55555555-5555-4555-8555-555555555555';
    const pass = '66666666-6666-4666-8666-666666666666';
    const unlocked = '77777777-7777-4777-8777-777777777777';
    const free = detail.title.seasons[0].episodes;
    const body = { title: { ...detail.title, seasons: [{ position: 1, episodes: [
        { ...free[0], id: thirdFree, position: 3 }, free[1], free[0],
        { ...free[2], position: 4 }, { ...free[2], id: pass, access: 'pass', position: 5 },
        { ...free[2], id: unlocked, access: 'unlocked', position: 6 },
    ] }] } };
    let active = 0;
    let maximum = 0;
    const requested: string[] = [];
    const release: Array<() => void> = [];
    mockRequest.mockImplementation((url: string) => {
        if (url.includes('/titles/')) return Promise.resolve(body);
        requested.push(url.split('content_id=')[1]);
        maximum = Math.max(maximum, ++active);
        return new Promise(resolve => release.push(() => { active--; resolve({ access: 'free', credits: 0 }); }));
    });
    mockParams = { id: seriesId }; await render(<TitleScreen />);
    expect(requested).toEqual([ids[0]]);
    await render(<TitleScreen />);
    expect(requested).toEqual([ids[0]]);
    await act(async () => release.shift()!());
    expect(requested).toEqual([ids[0], ids[1]]);
    await act(async () => release.shift()!());
    expect(requested).toEqual([ids[0], ids[1], thirdFree]);
    await act(async () => release.shift()!());
    expect(maximum).toBe(1);
    expect(active).toBe(0);
    expect(textOf(button('Paid episode'))).toContain('Paid title, not in the app yet');
    expect(requested).not.toEqual(expect.arrayContaining([ids[2], pass, unlocked]));
});
test('rapid refocus serializes replacement reads and ignores the stale batch', async () => {
    let active = 0;
    let maximum = 0;
    const requested: string[] = [];
    const release: Array<(body: unknown) => void> = [];
    mockRequest.mockImplementation((url: string) => {
        if (url.includes('/titles/')) return Promise.resolve(detail);
        requested.push(url.split('content_id=')[1]);
        maximum = Math.max(maximum, ++active);
        return new Promise(resolve => release.push(body => { active--; resolve(body); }));
    });
    mockParams = { id: seriesId }; await render(<TitleScreen />);
    for (let i = 0; i < 2; i++) {
        mockFocused = false; await render(<TitleScreen />);
        mockFocused = true; await render(<TitleScreen />);
    }
    expect(requested).toEqual([ids[0]]);
    await act(async () => release.shift()!({ access: 'locked', reason: 'free_ceiling', credits: 0 }));
    expect(requested).toEqual([ids[0], ids[0]]);
    expect(allText()).not.toContain('Free viewing used this month');
    await act(async () => release.shift()!({ access: 'free' }));
    expect(requested).toEqual([ids[0], ids[0], ids[1]]);
    await act(async () => release.shift()!({ access: 'free' }));
    expect(maximum).toBe(1);
    expect(active).toBe(0);
    expect(textOf(button('Free episode'))).toContain('2:05');
});
test('unchanged rerender and refocus do not repeat completed entitlement reads', async () => {
    mockParams = { id: seriesId }; await render(<TitleScreen />);
    const reads = () => mockRequest.mock.calls.filter(([url]) => url.includes('/entitlement?'));
    expect(reads()).toHaveLength(2);
    await render(<TitleScreen />);
    mockFocused = false; await render(<TitleScreen />);
    mockFocused = true; await render(<TitleScreen />);
    expect(reads()).toHaveLength(2);
    expect(textOf(button('Free episode'))).toContain('2:05');
});
test('series Play skips an exhausted first episode and refreshes on return to focus', async () => {
    const original = mockRequest.getMockImplementation()!;
    let exhausted = ids[0];
    mockRequest.mockImplementation((path: string) => path.includes('entitlement') ? Promise.resolve(path.endsWith(exhausted) ? { access: 'locked', reason: 'free_ceiling', credits: 0 } : { access: 'free', credits: 0 }) : original(path));
    mockParams = { id: seriesId }; await render(<TitleScreen />);
    await press(button('Watch'));
    expect(mockRouter.push.mock.calls[0][0].params.id).toBe(ids[1]);
    mockFocused = false; await render(<TitleScreen />);
    exhausted = ids[1]; mockFocused = true; await render(<TitleScreen />);
    expect(textOf(button('Exhausted episode'))).toContain('Free viewing used this month');
    await press(button('Watch'));
    expect(mockRouter.push.mock.calls[1][0].params.id).toBe(ids[0]);
});
test.each([403, 404, 503])('title error %s has no raw code', async status => {
    mockRequest.mockRejectedValue(new ApiError(status, 'title_not_found'));
    mockParams = { id: seriesId }; await render(<TitleScreen />);
    expect(allText()).toBe('This title is not available.');
});
test.each(['FILM', 'SHORT'])('%s Play keeps the existing route without a series parameter', async content_type => {
    mockRequest.mockResolvedValue({ title: { id: seriesId, content_type, title: 'Standalone', access: 'free' } });
    mockParams = { id: seriesId }; await render(<TitleScreen />);
    await press(button('Play'));
    expect(mockRouter.push).toHaveBeenCalledWith({ pathname: '/cinema/watch/[id]', params: { id: seriesId, title: 'Standalone' } });
});
test('non-UUID parent adds no header action', async () => {
    mockParams = { id: ids[0], series: 'black-dwarf-01' }; await render(<Watch />);
    expect(button('All episodes')).toBeUndefined();
});

// Exercise the SDK's real stack reducer, real Watch/CinemaPlayer and real playback session.
// Only the native video adapter and network are mocked; navigation removes mounted routes.
test.each([[true, false, false], [false, false, false], [true, false, true], [true, true, false]])('All episodes removes watch and stops heartbeat/audience (parent: %s, upper parent: %s, upper watch: %s)', async (parentPresent, upperParent, upperWatch) => {
    jest.useFakeTimers();
    const { StackRouter, StackActions } = require('expo-router/build/react-navigation/routers/StackRouter');
    const { createInitialState } = require('expo-router/build/react-navigation/core/createInitialState');
    const initialRouteName = parentPresent ? seriesRoute : watchRoute;
    const stack = StackRouter({ initialRouteName });
    // The SDK requires the empty metadata map; the app configures no per-route getId.
    const config = { routeGetIdList: {} };
    let state = createInitialState({ routeNames: [seriesRoute, watchRoute], initialRouteName, parentChain: 'cinema-test' });
    state.routes[0].params = parentPresent ? { id: upperParent ? seriesId.toUpperCase() : seriesId } : { id: ids[0], series: seriesId };
    function Harness() {
        const [, redraw] = useState(0);
        const dispatch = (action: any) => { state = stack.getStateForAction(state, action, config).state; redraw(++mockPage); };
        mockGetState.mockImplementation(() => state);
        mockRouter.push.mockImplementation(({ params }) => dispatch(StackActions.push(watchRoute, { ...params, series: upperWatch ? params.series.toUpperCase() : params.series })));
        mockRouter.dismissTo.mockImplementation((href: string) => dispatch(StackActions.popTo(seriesRoute, { id: href.split('/').pop() })));
        mockRouter.replace.mockImplementation((href: string) => dispatch(StackActions.replace(seriesRoute, { id: href.split('/').pop() })));
        return <>{state.routes.map((route: any, index: number) => <Route key={route.key} route={route} focused={index === state.index} />)}</>;
    }
    function Route({ route, focused }: any) {
        const Context = require('expo-router').__RouteContext;
        return <Context.Provider value={{ params: route.params, focused }}>{route.name === watchRoute ? <Watch /> : <TitleScreen />}</Context.Provider>;
    }
    await render(<Harness />);
    if (parentPresent) await press(button('Free episode'));
    expect(state.routes.filter((r: any) => r.name === watchRoute)).toHaveLength(1);
    for (let second = 1; second <= 31; second++) {
        await act(async () => { mockPlayer.currentTime = second; jest.advanceTimersByTime(1000); });
    }
    expect(mockRequest.mock.calls.some(([p]) => p.endsWith('/heartbeat'))).toBe(true);
    expect(mockRequest.mock.calls.some(([p]) => p.endsWith('/audience'))).toBe(true);
    await press(button('All episodes'));
    expect(mockRouter.dismissTo).toHaveBeenCalledTimes(parentPresent ? 1 : 0);
    expect(mockRouter.replace).toHaveBeenCalledTimes(parentPresent ? 0 : 1);
    expect(state.routes.map((r: any) => r.name)).toEqual([seriesRoute]);
    expect(state.routes[0].params.id).toBe(seriesId);
    expect(root.container.queryAll(n => n.type === 'VideoView')).toHaveLength(0);
    expect(mockPlayer.pause).toHaveBeenCalled();
    const calls = mockRequest.mock.calls.filter(([p]) => p.endsWith('/heartbeat') || p.endsWith('/audience')).length;
    await act(async () => jest.advanceTimersByTime(60000));
    expect(mockRequest.mock.calls.filter(([p]) => p.endsWith('/heartbeat') || p.endsWith('/audience'))).toHaveLength(calls);
});
