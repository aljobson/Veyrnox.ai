import { act } from 'react';
import { createRoot, type Root } from 'test-renderer';
import * as RN from 'react-native';
import Explore from '../src/app/(app)/music/explore';
import Track from '../src/app/(app)/music/track/[slug]';
import Creator from '../src/app/(app)/music/creator/[handle]';
import Blocked from '../src/app/(app)/music/blocked';
import ReportTrack from '../src/app/(app)/music/report-track';
import ReportComment from '../src/app/(app)/music/report-comment';
import { bindCacheUser, resetCacheUser } from '../src/lib/appCache';
import { publicSessionFor } from '../src/lib/music/usePublicMusic';
import { ApiError, type ApiClient } from '../src/lib/api';
import { plural, t } from '../src/lib/i18n';
import { actor, commenter, slug, commentId, nextId, creator, social, track, comments, best, profile, clone, deferred } from './fixtures/musicPublic';
const mockApi = { request: jest.fn() }, mockPush = jest.fn();
let mockParams: { slug?: string; handle?: string; commentId?: string; before?: string } = { slug };
jest.mock('../src/auth/AuthProvider', () => ({ useAuth: () => ({ api: mockApi }) }));
jest.mock('expo-router', () => ({ Stack: { Screen: () => null }, useRouter: () => ({ push: mockPush }), useLocalSearchParams: () => mockParams,
    useFocusEffect: (cb: () => void | (() => void)) => require('react').useEffect(cb, [cb]) }));
jest.mock('expo-crypto', () => ({ randomUUID: () => jest.requireActual('node:crypto').randomUUID() }));
jest.mock('../src/components/music/PublicPlayer', () => ({ PublicPlayer: ({ onPosition }: { onPosition(position: number): void }) => require('react').createElement(require('react-native').View, { testID: 'public-player', onPosition }) }));
void [RN.View, RN.ScrollView, RN.Text, RN.Pressable];
let root: Root;
const texts = (s: string) => root.container.queryAll(n => n.children.includes(s));
const buttons = (s: string) => root.container.queryAll(n => n.props.accessibilityRole === 'button' && n.props.accessibilityLabel === s);
const click = async (s: string) => { await act(async () => buttons(s)[0].props.onClick({ nativeEvent: {} })); };
const field = (s: string) => root.container.queryAll(n => n.props.accessibilityLabel === s && typeof n.props.onChangeText === 'function')[0];
const edit = async (label: string, value: string) => { await act(async () => field(label).props.onChangeText(value)); };
const mount = async (view: React.ReactElement) => { await act(async () => root.render(view)); };
const player = () => root.container.queryAll(n => n.props.testID === 'public-player');
const defaultRequest = async (path: string, init?: RequestInit) => {
    if (init?.method === 'POST') {
        const body = JSON.parse(init.body as string);
        if (path.endsWith('/blocks')) return { actor_id: body.actor_id, blocked: true, already: false };
        if (path.endsWith('/social')) return { social: { ...social, ...(Object.hasOwn(body, 'reaction') ? { my_reaction: body.reaction } : { following: body.following }) }, idempotent: false };
        if (body.action === 'report_song') return { status: 'reported' };
        return { id: commentId, status: body.action === 'submit' ? 'pending' : body.action === 'withdraw' ? 'withdrawn' : 'reported', idempotent: false };
    }
    if (init?.method === 'DELETE') return { actor_id: actor, blocked: false, already: false };
    if (path.endsWith('/blocks')) return { blocks: publicSessionFor(mockApi as unknown as ApiClient).snapshot().blocks };
    if (path.includes('/social?')) return { social };
    if (path.endsWith('best-of')) return best;
    if (path.includes('/creators/')) return profile;
    if (path.includes('/comments?')) return { comments: { ...comments, next_cursor: null } };
    return track;
};
beforeEach(async () => {
    resetCacheUser(); await bindCacheUser('p4b-screen-user'); jest.clearAllMocks(); mockParams = { slug };
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true; root = createRoot(); mockApi.request.mockImplementation(defaultRequest);
});
afterEach(async () => { await act(async () => { root.unmount(); resetCacheUser(); }); });
test('Explore rows navigate to native track and blocked list', async () => {
    await mount(<Explore />); await click(t('music.openNamed', { title: 'First track' }));
    expect(mockPush).toHaveBeenCalledWith({ pathname: '/music/track/[slug]', params: { slug } });
    await click(t('musicPublic.blockedCreators')); expect(mockPush).toHaveBeenCalledWith('/music/blocked');
});
test('Explore off hides all content and offers refresh', async () => {
    mockApi.request.mockRejectedValue(new ApiError(404, 'blocks_unavailable')); await mount(<Explore />);
    expect(texts(t('musicPublic.unavailable')).length).toBeGreaterThan(0); expect(texts('First track')).toHaveLength(0); expect(buttons(t('music.refresh')).length).toBeGreaterThan(0);
});
test('track shows listening, lyrics, social counts, pending comments and creator route', async () => {
    await mount(<Track />); expect(player()).toHaveLength(1); expect(texts(track.lyrics!)).toHaveLength(1);
    expect(texts(t('musicPublic.pending')).length).toBeGreaterThan(0); await click(creator.display_name);
    expect(mockPush).toHaveBeenCalledWith({ pathname: '/music/creator/[handle]', params: { handle: creator.handle } });
});
test('own track hides report, follow and creator block; unknown social does too', async () => {
    mockApi.request.mockImplementation((path, init) => path.includes('/social?') ? { social: { ...social, is_own: true } } : defaultRequest(path, init));
    await mount(<Track />); expect(buttons(t('musicPublic.reportTrack'))).toHaveLength(0); expect(buttons(t('musicPublic.follow'))).toHaveLength(0);
    expect(buttons(t('musicPublic.blockNamed', { name: creator.display_name }))).toHaveLength(0);
    await act(async () => root.unmount()); root = createRoot();
    mockApi.request.mockImplementation((path, init) => path.includes('/social?') ? Promise.reject(new ApiError(404, 'not_found')) : defaultRequest(path, init));
    await mount(<Track />); expect(player()).toHaveLength(1); expect(buttons(t('musicPublic.reportTrack'))).toHaveLength(0);
});
test('reaction toggles and clears; follow toggles', async () => {
    await mount(<Track />); const fire = t('musicPublic.reactionCount', { reaction: t('musicPublic.reaction.fire'), count: 1 });
    await click(fire); await click(fire); await click(t('musicPublic.follow')); await click(t('musicPublic.unfollow'));
    const bodies = mockApi.request.mock.calls.filter(([, init]) => init?.method === 'POST').map(([, init]) => JSON.parse(init.body));
    expect(bodies.map(b => b.reaction ?? b.following ?? null)).toEqual(['fire', null, true, false]);
});
test('comment submit shows pending and withdraws own comment', async () => {
    await mount(<Track />); await edit(t('musicPublic.commentBody'), 'New comment'); await click(t('musicPublic.submit'));
    expect(field(t('musicPublic.commentBody')).props.value).toBe(''); expect(texts(t('musicPublic.pending')).length).toBeGreaterThan(0);
    await click(t('comments.withdraw'));
    expect(mockApi.request.mock.calls.some(([, init]) => init?.body && JSON.parse(init.body).action === 'withdraw')).toBe(true);
});
test('blocking a commenter removes loaded comment and reply without navigation', async () => {
    await mount(<Track />); await click(t('musicPublic.reply')); expect(texts(t('musicPublic.replyTo', { name: 'Listener' })).length).toBeGreaterThan(0);
    mockApi.request.mockClear();
    await click(t('musicPublic.blockNamed', { name: 'Listener' }));
    expect(mockApi.request.mock.calls.map(([p]) => p).sort()).toEqual(['/api/v1/music/blocks', '/api/v1/music/blocks', `/api/v1/music/explore/tracks/${slug}`].sort());
    expect(texts('Lovely music')).toHaveLength(0); expect(texts(t('musicPublic.replyTo', { name: 'Listener' }))).toHaveLength(0);
    expect(texts(t('musicPublic.replyRemoved')).length).toBeGreaterThan(0); expect(player()).toHaveLength(1);
    expect(mockPush).not.toHaveBeenCalled();
});
test('blocked creator state disposes player and unblock restores track', async () => {
    await mount(<Track />); await click(t('musicPublic.blockNamed', { name: creator.display_name })); expect(player()).toHaveLength(0);
    expect(buttons(t('musicPublic.unblock'))).toHaveLength(1); await click(t('musicPublic.unblock')); expect(player()).toHaveLength(1);
});
test('creator follow and blocked list unblock', async () => {
    mockParams = { handle: creator.handle }; await mount(<Creator />); await click(t('musicPublic.follow')); expect(buttons(t('musicPublic.unfollow')).length).toBeGreaterThan(0);
    await act(async () => root.unmount()); root = createRoot();
    publicSessionFor(mockApi as unknown as ApiClient).acknowledge(actor, true, creator.display_name);
    await mount(<Blocked />); await click(t('musicPublic.unblock')); expect(texts(t('musicPublic.noBlocks')).length).toBeGreaterThan(0);
});
test('track and comment reports offer server block after success', async () => {
    await mount(<ReportTrack />); await edit(t('comments.reportDetails'), 'Please review this song'); await click(t('comments.send'));
    expect(texts(t('comments.reported')).length).toBeGreaterThan(0); expect(buttons(t('musicPublic.blockNamed', { name: creator.display_name })).length).toBeGreaterThan(0);
    await act(async () => root.unmount()); root = createRoot(); mockParams = { slug, commentId };
    await mount(<ReportComment />); await edit(t('comments.reportDetails'), 'Please review this comment'); await click(t('comments.send'));
    expect(buttons(t('musicPublic.blockNamed', { name: 'Listener' })).length).toBeGreaterThan(0);
});
test('account change clears composer and ignores late content', async () => {
    await mount(<Track />); await edit(t('musicPublic.commentBody'), 'Private draft');
    const late = deferred<unknown>(); mockApi.request.mockImplementation(path => path.endsWith('/blocks') ? { blocks: [] } : late.promise);
    await act(async () => bindCacheUser('different-user')); expect(field(t('musicPublic.commentBody'))).toBeUndefined();
    mockApi.request.mockImplementation(defaultRequest); await act(async () => late.resolve(clone(track)));
    expect(field(t('musicPublic.commentBody'))?.props.value ?? '').not.toBe('Private draft');
});

test('a timestamp can be removed even after playback moves beyond the comment timestamp limit', async () => {
    await mount(<Track />); await click(t('musicPublic.addTimestamp'));
    await act(async () => player()[0].props.onPosition(601));
    const remove = plural('musicPublic.removeTimestamp', 0);
    expect(buttons(remove)[0].props.accessibilityState.disabled).toBe(false); await click(remove);
    expect(buttons(t('musicPublic.addTimestamp'))[0].props.accessibilityState.disabled).toBe(true);
});

test('Explore opens with three reads, lazy actions share one ownership read per creator and account', async () => {
    const two = clone(best); two.playlists[0].tracks.push({ ...two.playlists[0].tracks[0], slug: 'abcdefabcdefabcdefabcdef', title: 'Second track' });
    mockApi.request.mockImplementation((path, init) => path.endsWith('best-of') ? two : defaultRequest(path, init));
    await mount(<Explore />);
    expect(mockApi.request.mock.calls.map(([p]) => p).sort()).toEqual([
      '/api/v1/music/blocks',
      '/api/v1/music/entitlements',
      '/api/v1/music/explore/albums',
      '/api/v1/music/explore/best-of',
    ]);
    await click(t('musicPublic.actions', { title: 'First track' }));
    await click(t('musicPublic.actions', { title: 'Second track' }));
    const socialReads = () => mockApi.request.mock.calls.filter(([p]) => p.includes('/social?'));
    expect(socialReads()).toHaveLength(1);
    const calls = mockApi.request.mock.calls.length;
    await act(async () => publicSessionFor(mockApi as unknown as ApiClient).acknowledge(commenter, true));
    expect(mockApi.request).toHaveBeenCalledTimes(calls);
    await act(async () => bindCacheUser('new-actions-account'));
    expect(buttons(t('musicPublic.reportTrack'))).toHaveLength(0);
    await click(t('musicPublic.actions', { title: 'First track' })); expect(socialReads()).toHaveLength(2);
});
test('Explore not_found uses Explore-specific copy and drops one bad row while retaining handle fallback', async () => {
    mockApi.request.mockImplementation((path, init) => path.endsWith('best-of') ? Promise.reject(new ApiError(404, 'not_found')) : defaultRequest(path, init));
    await mount(<Explore />); expect(texts(t('musicPublic.exploreUnavailable')).length).toBeGreaterThan(0);
    const data = clone(best); data.playlists[0].tracks[0].display_name = '';
    data.playlists[0].tracks.push({ ...data.playlists[0].tracks[0], slug: 'invalid', title: 'Bad row' });
    mockApi.request.mockImplementation((path, init) => path.endsWith('best-of') ? data : defaultRequest(path, init));
    await click(t('music.refresh')); expect(texts(creator.handle)).toHaveLength(1); expect(texts('Bad row')).toHaveLength(0);
});
test('comment reporting requests only the supplied page cursor and never scans later pages', async () => {
    mockParams = { slug, commentId: '55555555-5555-4555-8555-555555555555', before: nextId };
    mockApi.request.mockImplementation(async (path, init) => path.includes('/comments?') ? { comments } : defaultRequest(path, init));
    await mount(<ReportComment />);
    const pages = mockApi.request.mock.calls.filter(([p]) => p.includes('/comments?'));
    expect(pages.map(([p]) => p)).toEqual([`/api/v1/music/comments?slug=${slug}&before=${nextId}`]);
    expect(texts(t('musicPublic.reportUnavailable')).length).toBeGreaterThan(0);
});
test('comment reporting without a cursor does not scan when a comment is missing', async () => {
    mockParams = { slug, commentId: nextId }; await mount(<ReportComment />);
    expect(mockApi.request.mock.calls.filter(([p]) => p.includes('/comments?'))).toHaveLength(0);
});
test.each([
    ['reaction', 'not_found', 'musicPublic.socialUnavailable'],
    ['withdraw', 'not_found', 'musicPublic.commentGone'],
    ['report_song', 'music_song_reports_unavailable', 'musicPublic.reportUnavailable'],
])('definitive %s rejection removes replay and unlocks controls', async (action, code, message) => {
    await mount(action === 'report_song' ? <ReportTrack /> : <Track />);
    mockApi.request.mockImplementation((path, init) => init?.method === 'POST' ? Promise.reject(new ApiError(404, code)) : defaultRequest(path, init));
    if (action === 'report_song') { await edit(t('comments.reportDetails'), 'Please review'); await click(t('comments.send')); }
    else await click(action === 'withdraw' ? t('comments.withdraw') : t('musicPublic.reactionCount', { reaction: t('musicPublic.reaction.fire'), count: 1 }));
    expect(texts(t(message)).length).toBeGreaterThan(0);
    expect(texts(t('musicPlaylists.pending'))).toHaveLength(0);
    if (action === 'report_song') expect(field(t('comments.reportDetails')).props.editable).toBe(true);
    else expect(buttons(t('musicPublic.submit'))[0].props.accessibilityState.disabled).toBe(false);
});

test('reporting a later-page comment routes its cursor and loads it directly', async () => {
    const laterId = '55555555-5555-4555-8555-555555555555';
    mockApi.request.mockImplementation(async (path, init) => path.includes('/comments?') ? { comments: { ...comments,
        comments: [comments.comments[0], { ...comments.comments[0], id: laterId, body: 'Later comment' }], next_cursor: null,
    } } : defaultRequest(path, init));
    await mount(<Track />); await click(t('comments.more'));
    const report = buttons(t('comments.reportBy', { name: 'Listener' }));
    expect(report).toHaveLength(2); expect(texts('Lovely music')).toHaveLength(1); expect(texts('Later comment')).toHaveLength(1);
    await act(async () => report[1].props.onClick({ nativeEvent: {} }));
    expect(mockPush).toHaveBeenCalledWith({ pathname: '/music/report-comment', params: { slug, commentId: laterId, before: nextId } });
    await act(async () => root.unmount()); root = createRoot(); mockParams = { slug, commentId: laterId, before: nextId };
    mockApi.request.mockClear(); await mount(<ReportComment />);
    expect(field(t('comments.reportDetails'))).toBeDefined();
    expect(mockApi.request.mock.calls.filter(([p]) => p.includes('/comments?')).map(([p]) => p))
        .toEqual([`/api/v1/music/comments?slug=${slug}&before=${nextId}`]);
});
