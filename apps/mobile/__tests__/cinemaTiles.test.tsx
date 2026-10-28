import { act } from 'react';
import { createRoot, type Root, type TestInstance } from 'test-renderer';
import { router } from 'expo-router';
import Cinema from '../src/app/(app)/cinema/index';
import { CinemaFeed } from '../src/components/cinema/CinemaFeed';
import { DiscoveryList } from '../src/components/cinema/DiscoveryList';
import { EDITORIAL_SERIES } from '../src/lib/cinemaEditorialData';
import { fetchDiscovery, type DiscoveryResult } from '../src/lib/cinemaBrowse';
import { fetchFeedPage, isFeedTitle, parseTitle, type CinemaTitle } from '../src/lib/cinema';
import { t } from '../src/lib/i18n';

jest.setTimeout(30000);
let mockParams: Record<string, string> = {};
const mockRouter = { push: jest.fn(), replace: jest.fn(), back: jest.fn() };
jest.mock('expo-router', () => {
    const React = jest.requireActual('react');
    return {
        Stack: { Screen: () => null },
        router: { setParams: jest.fn(), push: jest.fn() },
        useRouter: () => mockRouter,
        useLocalSearchParams: () => mockParams,
        useFocusEffect: (effect: () => void | (() => void)) => { React.useEffect(() => effect(), [effect]); },
    };
});
jest.mock('expo-image', () => ({ Image: jest.requireActual('react-native').Image }));
jest.mock('../src/auth/AuthProvider', () => ({ useAuth: () => ({ api: { request: jest.fn() }, status: 'signedOut', getAccessToken: jest.fn() }) }));
jest.mock('../src/components/cinema/CinemaProfile', () => ({ CinemaProfile: () => null }));
jest.mock('../src/components/cinema/SavedList', () => ({ SavedList: () => null }));
jest.mock('../src/components/cinema/WinnersList', () => ({ WinnersList: () => null }));
jest.mock('../src/components/cinema/ContinueWatching', () => ({ ContinueWatching: () => jest.requireActual('react').createElement('ContinueWatching') }));
jest.mock('../src/components/cinema/CategoryChips', () => ({ CategoryChips: () => null }));
jest.mock('../src/components/cinema/TitleCard', () => ({
    TitleCard: ({ item }: any) => jest.requireActual('react').createElement('TitleCard', { title: item.title }),
}));
jest.mock('../src/lib/cinemaBrowse', () => ({ ...jest.requireActual('../src/lib/cinemaBrowse'), fetchDiscovery: jest.fn() }));
// Render the whole list so rows are observable; keep the props the tests read.
jest.mock('react-native', () => {
    const rn = jest.requireActual('react-native');
    return Object.defineProperty(Object.create(rn), 'FlatList', { value: ({ data, renderItem, keyExtractor, onEndReached, ListFooterComponent, numColumns, refreshControl }: any) => {
        const React = jest.requireActual('react');
        return React.createElement('FlatList', { onEndReached, numColumns, refreshControl }, data.map((item: any, index: number) =>
            React.createElement(React.Fragment, { key: keyExtractor(item) }, renderItem({ item, index }))), ListFooterComponent);
    } });
});
const native = jest.requireActual('react-native');
void [native.ActivityIndicator, native.Image, native.Pressable, native.ScrollView, native.StyleSheet, native.Text, native.View, native.RefreshControl];

const uuid = (n: number) => `${String(n).padStart(8, '0')}-1111-4111-8111-111111111111`;
const raw = (n: number, content_type: string, duration_seconds: number | null) => ({ id: uuid(n), content_type, title: `${content_type} ${n}`, duration_seconds, creator: { display_name: 'Ada' } });
const title = (n: number, type: string, seconds: number | null): CinemaTitle => parseTitle(raw(n, type, seconds))!;
const disc = (n: number, name = `Title ${n}`) => ({ ...title(n, 'FILM', 600), title: name, competitions: [] });
const body = (titles: unknown[], next: string | null) => ({ titles, next, next_id: next ? 'x' : undefined });
const response = (b: unknown) => ({ ok: true, status: 200, json: async () => b }) as unknown as Response;

let root: Root;
let fetchMock: jest.Mock;
beforeEach(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    jest.clearAllMocks();
    mockParams = {};
    jest.mocked(fetchDiscovery).mockResolvedValue({ kind: 'closed' });
    fetchMock = jest.fn(async () => response(body([], null)));
    (globalThis as any).fetch = fetchMock;
    root = createRoot();
});
afterEach(async () => { await act(async () => root.unmount()); });
const render = async (element: React.ReactElement) => { await act(async () => root.render(element)); };
const nodes = (role: string) => root.container.queryAll(n => n.props.accessibilityRole === role);
const textOf = (n: TestInstance): string => n.children.map(c => typeof c === 'string' ? c : textOf(c)).join('');
const allText = () => textOf(root.container);
const list = () => root.container.queryAll(n => n.type === 'FlatList')[0];
const labels = () => nodes('button').map(n => String(n.props.accessibilityLabel).split('. ')[0]);
const tab = (key: string) => nodes('tab').find(n => n.props.accessibilityLabel === t(`cinemaBrowse.tab.${key}`))!;
async function press(node: TestInstance) { await act(async () => node.props.onClick({ nativeEvent: {}, currentTarget: 1, target: 1 })); }
async function layout() {
    const host = root.container.queryAll(n => typeof n.props.onLayout === 'function')[0];
    await act(async () => host.props.onLayout({ nativeEvent: { layout: { width: 390, height: 800, x: 0, y: 0 } } }));
}
const cards = () => root.container.queryAll(n => n.type === 'TitleCard').map(n => n.props.title);

test('cinema opens on Series', async () => {
    await render(<Cinema />);
    expect(tab('series').props.accessibilityState.selected).toBe(true);
    expect(tab('watch').props.accessibilityState.selected).toBe(false);
    expect(fetchDiscovery).toHaveBeenCalledWith('series', null, null);
    expect(list().props.numColumns).toBe(2);
    expect(fetchMock).not.toHaveBeenCalled();
});

test('continue watching shows above the Series grid', async () => {
    await render(<Cinema />);
    const order = root.container.queryAll(n => n.type === 'ContinueWatching' || n.type === 'FlatList').map(n => n.type);
    expect(order).toEqual(['ContinueWatching', 'FlatList']);
});

test('section deep link still selects Watch', async () => {
    mockParams = { section: 'watch' };
    await render(<Cinema />);
    expect(tab('watch').props.accessibilityState.selected).toBe(true);
    expect(tab('series').props.accessibilityState.selected).toBe(false);
    expect(router.setParams).toHaveBeenCalledWith({ section: undefined });
});

test('series renders two columns with editorial first', async () => {
    jest.mocked(fetchDiscovery).mockResolvedValueOnce({ kind: 'ok', page: { titles: [disc(1, 'Database title')], next: null } });
    await render(<DiscoveryList mode="series" category={null} />);
    expect(list().props.numColumns).toBe(2);
    expect(labels()).toEqual([...EDITORIAL_SERIES.map(s => s.title), 'Database title']);
});

test('voting keeps one column', async () => {
    jest.mocked(fetchDiscovery).mockResolvedValueOnce({ kind: 'ok', page: { titles: [disc(1)], next: null } });
    await render(<DiscoveryList mode="voting" category={null} />);
    expect(list().props.numColumns ?? 1).toBe(1);
});

test('tile label carries title and creator', async () => {
    jest.mocked(fetchDiscovery).mockResolvedValueOnce({ kind: 'ok', page: { titles: [disc(1, 'Database title')], next: null } });
    await render(<DiscoveryList mode="series" category={null} />);
    const label = nodes('button').map(n => String(n.props.accessibilityLabel)).find(l => l.startsWith('Database title'))!;
    expect(label).toContain(t('cinemaSeries.by', { creator: 'Ada' }));
    expect(label).toContain(t('cinema.duration', { n: 10 }));
});

test('pull to refresh reloads page one and ignores an older page-two result', async () => {
    let releasePageTwo: (r: DiscoveryResult) => void = () => undefined;
    jest.mocked(fetchDiscovery)
        .mockResolvedValueOnce({ kind: 'ok', page: { titles: [disc(1, 'First')], next: { at: 'a', id: 'b' } } })
        .mockReturnValueOnce(new Promise(resolve => { releasePageTwo = resolve; }))
        .mockResolvedValueOnce({ kind: 'ok', page: { titles: [disc(3, 'Refreshed')], next: null } });
    await render(<DiscoveryList mode="series" category={null} />);
    await act(async () => { list().props.onEndReached(); });
    await act(async () => { list().props.refreshControl.props.onRefresh(); });
    await act(async () => { releasePageTwo({ kind: 'ok', page: { titles: [disc(2, 'Stale page two')], next: null } }); });
    expect(labels()).toEqual([...EDITORIAL_SERIES.map(s => s.title), 'Refreshed']);
    expect(list().props.refreshControl.props.refreshing).toBe(false);
    expect(fetchDiscovery).toHaveBeenLastCalledWith('series', null, null);
});

test('refresh failure keeps the rows', async () => {
    jest.mocked(fetchDiscovery)
        .mockResolvedValueOnce({ kind: 'ok', page: { titles: [disc(1, 'First')], next: null } })
        .mockResolvedValueOnce({ kind: 'error' });
    await render(<DiscoveryList mode="voting" category={null} />);
    await act(async () => { list().props.refreshControl.props.onRefresh(); });
    expect(labels()).toEqual(['First']);
    expect(allText()).not.toContain(t('cinemaBrowse.loadFailed'));
    expect(list().props.refreshControl.props.refreshing).toBe(false);
});

test('isFeedTitle drops SHORT, TRAILER and under 60 s, keeps unknown duration', () => {
    expect(isFeedTitle(title(1, 'FILM', 59))).toBe(false);
    expect(isFeedTitle(title(1, 'FILM', 60))).toBe(true);
    expect(isFeedTitle(title(1, 'FILM', null))).toBe(true);
    expect(isFeedTitle(title(1, 'SERIES', null))).toBe(true);
    expect(isFeedTitle(title(1, 'SHORT', 120))).toBe(false);
    expect(isFeedTitle(title(1, 'TRAILER', null))).toBe(false);
    expect(isFeedTitle({ ...title(1, 'FILM', 300), contentType: 'EPISODE' })).toBe(true);
});

test('fetchFeedPage skips an all-short page and stops after three pages', async () => {
    const one = jest.fn()
        .mockResolvedValueOnce(response(body([raw(1, 'SHORT', 8), raw(2, 'TRAILER', 30)], 'p2')))
        .mockResolvedValueOnce(response(body([raw(3, 'FILM', 600)], null)));
    const page = await fetchFeedPage(null, one as unknown as typeof fetch, 'https://x');
    expect(page.titles.map(x => x.title)).toEqual(['FILM 3']);
    expect(page.next).toBeNull();
    const shorts = jest.fn(async () => response(body([raw(9, 'SHORT', 8)], 'more')));
    const empty = await fetchFeedPage(null, shorts as unknown as typeof fetch, 'https://x');
    expect(empty.titles).toEqual([]);
    expect(empty.next).not.toBeNull();
    expect(shorts).toHaveBeenCalledTimes(3);
});

test('watch shows the show-more state after three short-only pages and loads more on tap', async () => {
    for (let i = 0; i < 3; i++) fetchMock.mockResolvedValueOnce(response(body([raw(10 + i, 'SHORT', 8)], `c${i}`)));
    fetchMock.mockResolvedValueOnce(response(body([raw(20, 'FILM', 900)], null)));
    await render(<CinemaFeed />);
    await layout();
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(allText()).toContain(t('cinemaBrowse.watchOnlyShort'));
    await press(nodes('button').find(n => textOf(n) === t('cinemaBrowse.showMore'))!);
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(cards()).toEqual(['FILM 20']);
});

test('watch never shows a short clip', async () => {
    fetchMock.mockResolvedValueOnce(response(body([raw(1, 'SHORT', 8), raw(2, 'FILM', 600), raw(3, 'TRAILER', 90), raw(4, 'SERIES', null), raw(5, 'FILM', 20)], null)));
    await render(<CinemaFeed />);
    await layout();
    expect(cards()).toEqual(['FILM 2', 'SERIES 4']);
});

const showMoreButton = () => nodes('button').find(n => textOf(n) === t('cinemaBrowse.showMore'));

test('watch offers show more after three short-only pages further down, and a tap reaches the long title', async () => {
    fetchMock.mockResolvedValueOnce(response(body([raw(1, 'FILM', 600)], 'c0')));
    for (let i = 0; i < 3; i++) fetchMock.mockResolvedValueOnce(response(body([raw(10 + i, 'SHORT', 8)], `c${i + 1}`)));
    fetchMock.mockResolvedValueOnce(response(body([raw(20, 'FILM', 900)], null)));
    await render(<CinemaFeed />);
    await layout();
    expect(showMoreButton()).toBeUndefined();
    await act(async () => { await list().props.onEndReached(); });
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(cards()).toEqual(['FILM 1']);
    expect(allText()).toContain(t('cinemaBrowse.watchOnlyShort'));
    await press(showMoreButton()!);
    expect(fetchMock).toHaveBeenCalledTimes(5);
    expect(cards()).toEqual(['FILM 1', 'FILM 20']);
    expect(showMoreButton()).toBeUndefined();
});

test('the end of the watch feed shows no show more', async () => {
    fetchMock.mockResolvedValueOnce(response(body([raw(1, 'FILM', 600)], 'c0')));
    fetchMock.mockResolvedValueOnce(response(body([raw(2, 'SHORT', 8)], null)));
    await render(<CinemaFeed />);
    await layout();
    await act(async () => { await list().props.onEndReached(); });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(cards()).toEqual(['FILM 1']);
    expect(showMoreButton()).toBeUndefined();
    expect(allText()).not.toContain(t('cinemaBrowse.watchOnlyShort'));
});
