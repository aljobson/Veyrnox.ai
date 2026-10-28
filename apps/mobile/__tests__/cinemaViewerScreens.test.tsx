import { act, useState } from 'react';
import { createRoot, type Root, type TestInstance } from 'test-renderer';
import { Alert, AppState, StyleSheet, type AppStateStatus } from 'react-native';
import { DiscoveryList } from '../src/components/cinema/DiscoveryList';
import { CinemaPosterImage } from '../src/components/cinema/CinemaPosterImage';
import { CommentsPreview } from '../src/components/cinema/CommentsPreview';
import { VotePolls } from '../src/components/cinema/VotePolls';
import { AnalyticsEntry } from '../src/components/cinema/AnalyticsEntry';
import Title from '../src/app/(app)/cinema/[id]';
import Watch from '../src/app/(app)/cinema/watch/[id]';
import Comments from '../src/app/(app)/cinema/comments';
import Analytics from '../src/app/(app)/cinema/analytics';
import { fetchDiscovery } from '../src/lib/cinemaBrowse';
import { parseTitle } from '../src/lib/cinema';
import { ApiError } from '../src/lib/api';
import { t } from '../src/lib/i18n';

declare const require: (id: string) => any;
jest.setTimeout(30000);
const mockRequest = jest.fn();
const mockAuth = { api: { request: mockRequest }, getAccessToken: jest.fn() };
const mockRouter = { push: jest.fn(), replace: jest.fn(), back: jest.fn(), dismissTo: jest.fn(), canGoBack: jest.fn(() => false) };
let mockParams: Record<string, string> = {};
let mockFocused = true;
let mockKey = 0;
const mockSave = jest.fn(async () => undefined);
let mockPlaying: ((event: { isPlaying: boolean }) => void) | undefined;
let mockAppState: ((state: AppStateStatus) => void) | undefined;
const mockPlayer = {
    currentTime: 0, playing: false, keepScreenOnWhilePlaying: false,
    replaceAsync: jest.fn(async (): Promise<void> => undefined),
    play: jest.fn(() => { mockPlayer.playing = true; mockPlaying?.({ isPlaying: true }); }),
    pause: jest.fn(() => { mockPlayer.playing = false; mockPlaying?.({ isPlaying: false }); }),
    addListener: jest.fn((name: string, callback: any) => { if (name === 'playingChange') mockPlaying = callback; return { remove: jest.fn() }; }),
};
jest.mock('expo-router', () => {
    const React = jest.requireActual('react');
    const RouteContext = React.createContext(null);
    return {
        __RouteContext: RouteContext, Stack: { Screen: ({ options }: any) => options.headerRight?.() ?? null }, Link: 'Link',
        useRouter: () => mockRouter, useNavigation: () => ({ getState: () => ({ routes: [] }) }),
        useLocalSearchParams: () => React.useContext(RouteContext)?.params ?? mockParams,
        useFocusEffect: (effect: () => void | (() => void)) => {
            const focused = React.useContext(RouteContext)?.focused ?? mockFocused;
            React.useEffect(() => focused ? effect() : undefined, [effect, focused]);
        },
    };
});
jest.mock('expo-image', () => ({ Image: 'PosterImage' }));
jest.mock('expo-crypto', () => ({ randomUUID: () => `00000000-0000-4000-8000-${String(++mockKey).padStart(12, '0')}` }));
jest.mock('expo-video', () => ({ useVideoPlayer: () => mockPlayer, VideoView: 'VideoView' }));
jest.mock('../src/auth/AuthProvider', () => ({ useAuth: () => mockAuth }));
jest.mock('../src/components/cinema/SaveFollow', () => ({ SaveFollow: () => null }));
jest.mock('../src/lib/cinemaBrowse', () => ({ ...jest.requireActual('../src/lib/cinemaBrowse'), fetchDiscovery: jest.fn() }));
jest.mock('../src/lib/cinemaProgress', () => ({ getCinemaProgress: () => ({ recorder: () => mockSave }) }));
jest.mock('react-native', () => {
    const rn = jest.requireActual('react-native');
    return Object.defineProperty(Object.create(rn), 'FlatList', { value: ({ data, renderItem, keyExtractor, ListHeaderComponent, ListFooterComponent, ListEmptyComponent }: any) => {
        const React = jest.requireActual('react');
        return React.createElement('FlatList', {}, ListHeaderComponent, data.length ? data.map((item: any, index: number) =>
            React.createElement(React.Fragment, { key: keyExtractor(item) }, renderItem({ item, index }))) : ListEmptyComponent, ListFooterComponent);
    } });
});
const series = '11111111-1111-4111-8111-111111111111';
const one = '22222222-2222-4222-8222-222222222222';
const two = '33333333-3333-4333-8333-333333333333';
const three = '44444444-4444-4444-8444-444444444444';
const detail = { title: { id: series, title: 'Series title', content_type: 'SERIES', language: 'en-GB', ai_disclosures: ['generated_video'], creator: { display_name: 'Creator' }, seasons: [{ id: 's1', title: 'Season subtitle', position: 1, episodes: [
    { id: one, title: 'First episode', position: 1, synopsis: 'First synopsis', access: 'free', duration_seconds: 65 },
    { id: two, title: 'Second episode', position: 2, synopsis: 'Second synopsis', access: 'free', duration_seconds: 80 },
] }] } };
const grant = () => ({ token: 'head.body.sig', customer_code: 'abc', expires_at: new Date(Date.now() + 900000).toISOString(), watch_session_id: series });
async function defaultRequest(path: string) {
    if (path.includes('/titles/')) return detail;
    if (path.includes('/entitlement?')) return { access: 'free' };
    if (path === '/api/v1/cinema/play') return grant();
    if (path.endsWith('/heartbeat')) return { access: 'free' };
    if (path.endsWith('/audience')) return {};
    if (path.includes('/voting?')) throw new ApiError(503, 'voting_not_open');
    if (path.includes('/story-polls?')) throw new ApiError(503, 'story_polls_not_open');
    throw new ApiError(503, 'comments_not_open');
}
let root: Root;
beforeEach(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    jest.clearAllMocks();
    Object.values(mockRouter).forEach(fn => fn.mockReset()); mockRouter.canGoBack.mockReturnValue(false);
    mockParams = {}; mockFocused = true; mockKey = 0;
    mockPlayer.currentTime = 0; mockPlayer.playing = false; mockPlaying = undefined;
    mockPlayer.replaceAsync.mockImplementation(async () => undefined);
    AppState.currentState = 'active';
    jest.spyOn(AppState, 'addEventListener').mockImplementation((_event, cb) => { mockAppState = cb; return { remove: jest.fn() }; });
    mockRequest.mockImplementation(defaultRequest);
    jest.mocked(fetchDiscovery).mockResolvedValue({ kind: 'closed' });
    root = createRoot();
});
afterEach(async () => { await act(async () => root.unmount()); jest.restoreAllMocks(); jest.useRealTimers(); });
const render = async (element: React.ReactElement) => { await act(async () => root.render(element)); };
const textOf = (node: TestInstance): string => node.children.map(c => typeof c === 'string' ? c : textOf(c)).join('');
const text = () => textOf(root.container);
const nodes = (role: string) => root.container.queryAll(n => n.props.accessibilityRole === role);
const button = (label: string) => nodes('button').find(n => n.props.accessibilityLabel === label || textOf(n) === label)!;
const press = async (node: TestInstance) => { await act(async () => node.props.onClick({ nativeEvent: {}, currentTarget: 1, target: 1 })); };
const images = () => root.container.queryAll(n => n.type === 'PosterImage');
const next = () => button(t('cinema.player.next'));
const calls = (fragment: string) => mockRequest.mock.calls.filter(([path]) => path.includes(fragment));

test('episode discovery uses watch route, metadata, all competitions and voting explainer', async () => {
    const title = parseTitle({ id: one, title: 'Discovery episode', content_type: 'EPISODE', root_id: series, series_title: 'Parent series', duration_seconds: 30 })!;
    jest.mocked(fetchDiscovery).mockResolvedValue({ kind: 'ok', page: { titles: [{ ...title, competitions: [two, three].map((id, index) => ({ id, name: `Competition ${index}`, endsAt: '2027-01-01T00:00:00Z', qualifiedVotes: index })) }], next: null } });
    await render(<DiscoveryList mode="voting" category={null} />);
    expect(text()).toContain(t('cinema.discovery.exploreTitlesEligibleForAnOpen'));
    expect(text()).toContain('From Parent series'); expect(text()).toContain('1 min');
    expect(text()).toContain('Competition 0'); expect(text()).toContain('Competition 1');
    await press(button('Discovery episode'));
    expect(mockRouter.push).toHaveBeenCalledWith({ pathname: '/cinema/watch/[id]', params: { id: one, title: 'Discovery episode', series } });
});
test('landscape poster falls back from curated to API then disappears, resetting for another id', async () => {
    await render(<CinemaPosterImage id="5cc7db34-2b81-4eb2-83bf-7e52ff650b07" />);
    expect(StyleSheet.flatten(images()[0].props.style).aspectRatio).toBe(16 / 9);
    expect(images()[0].props.source.uri).toContain('/cinema/posters/painting-with-the-breeze.jpg');
    await act(async () => images()[0].props.onError());
    expect(images()[0].props.source.uri).toContain('/api/cinema/posters/');
    await act(async () => images()[0].props.onError());
    expect(images()).toHaveLength(0);
    await render(<CinemaPosterImage id={one} />); expect(images()).toHaveLength(1);
});
test('title displays language, disclosures, season title, episode synopsis and Free', async () => {
    mockParams = { id: series }; await render(<Title />);
    for (const value of ['Language: en-GB', t('cinemaUpload.disclosure.generated_video'), 'Season 1', 'Season subtitle', 'First synopsis', 'Free']) expect(text()).toContain(value);
    expect(nodes('header').map(textOf)).toEqual(expect.arrayContaining(['Series title', 'Season 1', t('cinemaViewer.aiUse')]));
    expect(button(t('cinemaViewer.openComments'))).toBeUndefined();
});
test.each([[503, 'viewing_not_open', 'cinema.discovery.socialCinemaViewingIsNotOpen'], [500, 'failure', 'cinema.titlePage.couldNotLoadThisTitleTry'], [404, 'missing', 'cinema.thistitleisnotavailable'], [400, 'bad', 'cinema.thistitleisnotavailable']])('title state %s offers back and only transient failure retries', async (status, code, key) => {
    mockRequest.mockRejectedValue(new ApiError(Number(status), String(code)));
    mockParams = { id: series }; await render(<Title />);
    expect(text()).toContain(t(String(key))); expect(text()).not.toContain(`api_${code}`);
    expect(!!button(t('recovery.retry'))).toBe(status === 500);
    await press(button(t('cinema.back'))); expect(mockRouter.replace).toHaveBeenCalledWith('/cinema');
    mockRouter.canGoBack.mockReturnValue(true); await press(button(t('cinema.back'))); expect(mockRouter.back).toHaveBeenCalled();
    if (status === 500) { mockRequest.mockImplementation(defaultRequest); await press(button(t('recovery.retry'))); expect(text()).toContain('Series title'); }
});
test('comment switch hides preview; quota errors show the mapped retry row', async () => {
    await render(<CommentsPreview contentId={one} />); expect(text()).toBe('');
    mockRequest.mockRejectedValue(new ApiError(429, 'rate_limited'));
    await render(<CommentsPreview key="quota" contentId={one} />);
    expect(button(t('comments.err.rate'))).toBeDefined();
    mockRequest.mockResolvedValue({ comments: [] }); await press(button(t('comments.err.rate')));
    expect(text()).toContain(t('comments.none'));
});
test('preview clears old rows on refocus and ignores earlier focus responses', async () => {
    let finish!: (body: unknown) => void;
    mockRequest.mockResolvedValue({ comments: [{ id: two, body: 'Old row' }] });
    await render(<CommentsPreview contentId={one} />); expect(text()).toContain('Old row');
    mockFocused = false; await render(<CommentsPreview contentId={one} />);
    mockRequest.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    mockFocused = true; await render(<CommentsPreview contentId={one} />); expect(text()).not.toContain('Old row');
    mockFocused = false; await render(<CommentsPreview contentId={one} />);
    mockRequest.mockResolvedValue({ comments: [{ id: three, body: 'Fresh row' }] });
    mockFocused = true; await render(<CommentsPreview contentId={one} />);
    await act(async () => finish({ comments: [{ id: two, body: 'Late row' }] }));
    expect(text()).toContain('Fresh row'); expect(text()).not.toContain('Late row');
});
test('Watch confirms Next only after the metered response and rechecks before replacing', async () => {
    let finish!: (body: unknown) => void;
    mockRequest.mockImplementation(path => path.includes('/entitlement?') ? new Promise(resolve => { finish = resolve; }) : defaultRequest(path));
    mockParams = { id: one, series }; await render(<Watch />);
    expect(text()).toContain('Series title'); expect(text()).toContain('Season 1, Episode 1'); expect(next()).toBeUndefined();
    await act(async () => finish({ access: 'free' })); expect(next()).toBeDefined();
    await act(async () => { next().props.onClick({ nativeEvent: {} }); });
    expect(next().props.accessibilityState.disabled).toBe(true); expect(mockRouter.replace).not.toHaveBeenCalled();
    await act(async () => finish({ access: 'free' }));
    expect(mockRouter.replace).toHaveBeenCalledWith({ pathname: '/cinema/watch/[id]', params: { id: two, title: 'Second episode', series } });
    expect(calls('/entitlement?')).toHaveLength(2);
});
test.each(['free_ceiling', 'detail_lock', 'failed_detail', 'missing_episode'])('Watch hides Next for %s', async scenario => {
    mockRequest.mockImplementation(path => {
        if (path.includes('/entitlement?') && scenario === 'free_ceiling') return Promise.resolve({ access: 'locked', reason: 'free_ceiling' });
        if (path.includes('/titles/') && scenario === 'failed_detail') return Promise.reject(new ApiError(500, 'error'));
        if (path.includes('/titles/') && scenario === 'detail_lock') return Promise.resolve({ title: { ...detail.title, seasons: [{ ...detail.title.seasons[0], episodes: [detail.title.seasons[0].episodes[0], { ...detail.title.seasons[0].episodes[1], access: 'locked' }] }] } });
        return defaultRequest(path);
    });
    mockParams = { id: scenario === 'missing_episode' ? three : one, series }; await render(<Watch />);
    expect(next()).toBeUndefined(); expect(mockRouter.replace).not.toHaveBeenCalled();
    if (scenario !== 'free_ceiling') expect(calls('/entitlement?')).toHaveLength(0);
});
test('Next recheck denial hides the button without navigating', async () => {
    mockParams = { id: one, series }; await render(<Watch />); expect(next()).toBeDefined();
    mockRequest.mockImplementation(path => path.includes('/entitlement?') ? Promise.resolve({ access: 'locked', reason: 'free_ceiling' }) : defaultRequest(path));
    await press(next()); expect(next()).toBeUndefined(); expect(mockRouter.replace).not.toHaveBeenCalled();
});
test('heartbeat ceiling removes Next until a fresh focus', async () => {
    jest.useFakeTimers(); mockParams = { id: one, series }; await render(<Watch />); expect(next()).toBeDefined();
    mockRequest.mockImplementation(path => path.endsWith('/heartbeat') ? Promise.resolve({ access: 'locked', reason: 'free_ceiling' }) : defaultRequest(path));
    await act(async () => jest.advanceTimersByTime(31000));
    expect(next()).toBeUndefined(); expect(mockRouter.replace).not.toHaveBeenCalled(); expect(calls('/entitlement?')).toHaveLength(1);
    await act(async () => jest.advanceTimersByTime(31000)); expect(calls('/entitlement?')).toHaveLength(1);
    mockFocused = false; await render(<Watch />); mockFocused = true; await render(<Watch />);
    expect(calls('/entitlement?')).toHaveLength(2);
});
test('standalone Watch with switches off leaves an empty panel', async () => {
    mockParams = { id: one }; await render(<Watch />);
    expect(text()).toBe(''); expect(calls('/titles/')).toHaveLength(0);
});

function commentJourney(screen: 'Watch' | 'Title') {
    const Context = require('expo-router').__RouteContext;
    return function Journey() {
        const [comments, setComments] = useState(false);
        mockRouter.push.mockImplementation(() => setComments(true)); mockRouter.back.mockImplementation(() => setComments(false));
        const params = screen === 'Watch' ? { id: one, series } : { id: series };
        return <><Context.Provider value={{ params, focused: !comments }}>{screen === 'Watch' ? <Watch /> : <Title />}</Context.Provider>
            {comments ? <Context.Provider value={{ params: { id: params.id }, focused: true }}><Comments /></Context.Provider> : null}</>;
    };
}
test.each([['Watch', 'withdraw'], ['Watch', 'block'], ['Title', 'withdraw'], ['Title', 'block']] as const)('%s preview refreshes after Comments %s and return', async (screen, action) => {
    jest.useFakeTimers();
    let removed = false;
    mockRequest.mockImplementation((path, init) => {
        if (path.includes('/comments?')) return Promise.resolve({ comments: removed ? [] : [{ id: three, body: 'Visible comment', own: action === 'withdraw', username: 'author', display_name: 'Author' }] });
        if (init?.method === 'POST') { if (path.endsWith('/comments') || path.includes('/blocks')) { removed = true; return Promise.resolve({}); } }
        return defaultRequest(path);
    });
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    const Journey = commentJourney(screen); await render(<Journey />); expect(text()).toContain('Visible comment');
    await press(button(t('cinemaViewer.openComments')));
    if (screen === 'Watch') {
        expect(mockPlayer.pause).toHaveBeenCalled();
        const reads = mockRequest.mock.calls.length, saves = mockSave.mock.calls.length;
        await act(async () => { mockAppState?.('active'); jest.advanceTimersByTime(61000); });
        expect(mockRequest).toHaveBeenCalledTimes(reads); expect(mockSave).toHaveBeenCalledTimes(saves); expect(mockPlayer.playing).toBe(false);
    }
    await press(button(action === 'withdraw' ? t('comments.withdrawLabel') : t('blocks.blockMember', { name: 'Author' })));
    const confirm = alert.mock.calls.at(-1)![2]!.find(option => option.style === 'destructive')!;
    await act(async () => confirm.onPress?.()); expect(removed).toBe(true);
    const plays = mockPlayer.play.mock.calls.length;
    await act(async () => mockRouter.back()); expect(text()).not.toContain('Visible comment');
    if (screen === 'Watch') { expect(mockPlayer.play).toHaveBeenCalledTimes(plays); expect(calls('/cinema/play').filter(([path]) => path.endsWith('/play'))).toHaveLength(1); }
});
test('every nonwithdrawn own status and public own comment offers Withdraw', async () => {
    mockParams = { id: one };
    mockRequest.mockResolvedValue({ comments: [{ id: two, body: 'Public own', own: true }], own_comments: ['pending', 'approved', 'rejected', 'removed', 'withdrawn'].map((status, index) => ({ id: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`, body: status, status })) });
    await render(<Comments />);
    expect(nodes('button').filter(n => n.props.accessibilityLabel === t('comments.withdrawLabel'))).toHaveLength(5);
});
test('vote network retry keeps its key; success starts a new intent key', async () => {
    let attempts = 0;
    mockRequest.mockImplementation((path) => {
        if (path.includes('/voting?')) return Promise.resolve({ competitions: [{ id: two, name: 'Open competition', starts_at: '2020-01-01', ends_at: '2099-01-01' }] });
        if (path.endsWith('/votes')) { if (++attempts === 1) return Promise.reject(new ApiError(0, 'network')); return Promise.resolve({ status: 'qualified' }); }
        return defaultRequest(path);
    });
    await render(<VotePolls contentId={one} />);
    for (let i = 0; i < 3; i++) await press(button(t('cinemaSocial.voteFor', { name: 'Open competition' })));
    const keys = calls('/votes').map(([, init]) => init.headers['Idempotency-Key']);
    expect(keys[0]).toBe(keys[1]); expect(keys[2]).not.toBe(keys[1]);
    expect(text()).toContain(t('cinema.voting.oneVotePerTitleInEach'));
});
test('poll options select radios and submit only through the explicit button', async () => {
    mockRequest.mockImplementation(path => path.includes('/story-polls?') ? Promise.resolve({ polls: [{ id: three, question: 'Which?', is_open: true, closes_at: '2027-01-01T00:00:00Z', options: [{ id: one, label: 'One' }, { id: two, label: 'Two' }] }] }) : path.endsWith('/story-choices') ? Promise.resolve({}) : defaultRequest(path));
    await render(<VotePolls contentId={one} />);
    expect(button(t('cinema.storyPolls.submitStoryChoice')).props.accessibilityState.disabled).toBe(true);
    await press(nodes('radio')[0]); expect(calls('/story-choices')).toHaveLength(0);
    expect(nodes('radio')[0].props.accessibilityState.checked).toBe(true);
    await press(button(t('cinema.storyPolls.submitStoryChoice'))); expect(calls('/story-choices')).toHaveLength(1);
    expect(JSON.parse(calls('/story-choices')[0][1].body)).toEqual({ poll_id: three, option_id: one });
    expect(text()).toContain(t('cinema.storyPolls.answersHeldForReviewAreExcluded'));
});
test.each([503, 400])('analytics entry responds to switch probe %s', async status => {
    mockRequest.mockRejectedValue(new ApiError(status, status === 400 ? 'invalid_query' : 'analytics_not_open'));
    await render(<AnalyticsEntry />); expect(!!button(t('cinemaCreator.analytics.open'))).toBe(status === 400);
    if (status === 400) { await press(button(t('cinemaCreator.analytics.open'))); expect(mockRouter.push).toHaveBeenCalledWith('/cinema/analytics'); }
    expect(mockRequest).toHaveBeenCalledTimes(1);
});
test('analytics picker empty state and selected published title', async () => {
    mockRequest.mockResolvedValue({ content: [] }); await render(<Analytics />);
    expect(text()).toContain(t('cinema.creatorAnalytics.publishATitleToStartSeeing'));
    mockParams = { id: two };
    mockRequest.mockImplementation(path => path.endsWith('/content') ? Promise.resolve({ content: [one, two].map((id, i) => ({ id, title: `Title ${i}`, lifecycle_status: 'PUBLISHED', visibility: 'PUBLIC', parent_id: null })) }) : Promise.reject(new ApiError(503, 'analytics_not_open')));
    await render(<Analytics key="picker" />);
    expect(button('Title 1').props.accessibilityState.selected).toBe(true);
    expect(calls('/creator-analytics').at(-1)![0]).toContain(two);
    await press(button('Title 0')); expect(calls('/creator-analytics').at(-1)![0]).toContain(one);
    expect(text()).toContain(t('cinema.creatorAnalytics.completionMeansAtLeast90Of'));
});

test.each([false, true])('Watch delayed first load stays paused after blur (refocused before completion: %s)', async refocus => {
    jest.useFakeTimers();
    let finish!: () => void;
    mockPlayer.replaceAsync.mockImplementation(() => new Promise<void>(resolve => { finish = resolve; }));
    mockParams = { id: one, position: '27' }; await render(<Watch />);
    mockFocused = false; await render(<Watch />);
    if (refocus) { mockFocused = true; await render(<Watch />); }
    await act(async () => finish());
    expect(mockPlayer.currentTime).toBe(27); expect(mockPlayer.play).not.toHaveBeenCalled();
    const sent = mockRequest.mock.calls.length;
    await act(async () => jest.advanceTimersByTime(61000));
    expect(mockRequest).toHaveBeenCalledTimes(sent); expect(mockSave).not.toHaveBeenCalled();
    expect(calls('/cinema/play')).toHaveLength(1);
});
test('Watch delayed renewal stays paused at saved position after blur and refocus', async () => {
    jest.useFakeTimers(); mockParams = { id: one }; await render(<Watch />);
    expect(mockPlayer.play).toHaveBeenCalledTimes(1);
    mockPlayer.currentTime = 52;
    let finish!: () => void;
    mockPlayer.replaceAsync.mockImplementation(() => new Promise<void>(resolve => { finish = resolve; }));
    await act(async () => jest.advanceTimersByTime(720000));
    expect(mockPlayer.replaceAsync).toHaveBeenCalledTimes(2);
    mockFocused = false; await render(<Watch />); mockFocused = true; await render(<Watch />);
    mockPlayer.currentTime = 0;
    await act(async () => finish());
    expect(mockPlayer.currentTime).toBe(52); expect(mockPlayer.play).toHaveBeenCalledTimes(1);
    expect(calls('/cinema/play').filter(([path]) => path.endsWith('/play'))).toHaveLength(2);
});
test('block before detail completion suppresses candidate checking until next focus', async () => {
    let finish!: (body: unknown) => void;
    mockRequest.mockImplementation(path => path.includes('/titles/') ? new Promise(resolve => { finish = resolve; })
        : path.endsWith('/play') ? Promise.reject(new ApiError(402, 'locked', { reason: 'free_ceiling' })) : defaultRequest(path));
    mockParams = { id: one, series }; await render(<Watch />);
    await act(async () => finish(detail));
    expect(next()).toBeUndefined(); expect(calls('/entitlement?')).toHaveLength(0);
    mockFocused = false; await render(<Watch />); mockFocused = true; await render(<Watch />);
    expect(calls('/entitlement?')).toHaveLength(1);
});
test('a late metered response cannot restore Next after heartbeat denial', async () => {
    jest.useFakeTimers();
    let finish!: (body: unknown) => void;
    mockRequest.mockImplementation(path => path.includes('/entitlement?') ? new Promise(resolve => { finish = resolve; })
        : path.endsWith('/heartbeat') ? Promise.resolve({ access: 'locked', reason: 'free_ceiling' }) : defaultRequest(path));
    mockParams = { id: one, series }; await render(<Watch />);
    await act(async () => jest.advanceTimersByTime(31000));
    await act(async () => finish({ access: 'free' }));
    expect(next()).toBeUndefined(); expect(mockRouter.replace).not.toHaveBeenCalled();
});
test.each(['qualified', 'under_review', 'rejected'])('poll shows moderation status %s', async status => {
    mockRequest.mockImplementation(path => path.includes('/story-polls?') ? Promise.resolve({ polls: [{ id: three, question: 'Choice', is_open: false, closes_at: '2026-01-01', options: [{ id: one, label: 'One' }, { id: two, label: 'Two' }], my_choice: { option_id: one, status } }] }) : defaultRequest(path));
    await render(<VotePolls contentId={one} />);
    const key = status === 'qualified' ? 'cinema.storyPolls.yourChoiceIsCounted' : status === 'under_review' ? 'cinema.storyPolls.yourChoiceIsAwaitingReview' : 'cinema.storyPolls.yourChoiceWasExcludedByModeration';
    expect(text()).toContain(t(key)); expect(button(t('cinema.storyPolls.submitStoryChoice'))).toBeUndefined();
    expect(nodes('radio')[0].props.accessibilityState.checked).toBe(true);
});
test('open voting with no competitions explains the empty read', async () => {
    mockRequest.mockImplementation(path => path.includes('/voting?') ? Promise.resolve({ competitions: [] }) : defaultRequest(path));
    await render(<VotePolls contentId={one} />);
    expect(text()).toContain(t('cinema.voting.noOpenCompetitionForThisTitle'));
});
