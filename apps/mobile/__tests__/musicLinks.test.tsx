import { ApiError } from '../src/lib/api';
import { act } from 'react';
import { createRoot, type Root } from 'test-renderer';
import * as RN from 'react-native';
import { MusicLinkShare } from '../src/components/music/MusicLinkShare';
import { MusicPublication } from '../src/components/music/MusicPublication';
import Track from '../src/app/(app)/music/track/[slug]';
import Creator from '../src/app/(app)/music/creator/[handle]';
import { publicTrackUrl, publicCreatorUrl } from '../src/lib/music/musicLinks';
import { bindCacheUser, resetCacheUser } from '../src/lib/appCache';
import { t } from '../src/lib/i18n';
import { publication, detail } from './fixtures/musicPublication';
import { track, profile, social, creator, slug } from './fixtures/musicPublic';
const mockApi = { request: jest.fn() };
jest.mock('../src/auth/AuthProvider', () => ({ useAuth: () => ({ api: mockApi, generation: 0 }) }));
jest.mock('expo-router', () => ({ Stack: { Screen: () => null }, useRouter: () => ({ push: jest.fn() }), useLocalSearchParams: () => ({ slug: jest.requireActual('./fixtures/musicPublic').slug, handle: 'creator_one' }),
    useFocusEffect: (cb: () => void | (() => void)) => jest.requireActual('react').useEffect(cb, [cb]) }));
jest.mock('../src/components/music/PublicPlayer', () => ({ PublicPlayer: () => null }));
void [RN.View, RN.Text, RN.Pressable, RN.ScrollView, RN.Modal];
let root: Root;
beforeEach(async () => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true; resetCacheUser(); await bindCacheUser('share-user');
    jest.clearAllMocks(); root = createRoot(); jest.spyOn(RN.Share, 'share').mockResolvedValue({ action: RN.Share.sharedAction, activityType: undefined });
    mockApi.request.mockImplementation(async (path: string) => path.endsWith('/blocks') ? { blocks: [] } : path.endsWith('/publication') ? { publication }
        : path.includes('/creators/') ? profile : path.includes('/social?') ? { social } : track);
});
afterEach(async () => { await act(async () => { root.unmount(); resetCacheUser(); }); jest.restoreAllMocks(); });
async function share(view: React.ReactElement, key: string, url: string) {
    await act(async () => root.render(view));
    const button = root.container.queryAll(n => n.props.accessibilityRole === 'button' && n.props.accessibilityLabel === t(key))[0];
    expect(button).toBeDefined(); await act(async () => button.props.onClick({ nativeEvent: {} }));
    expect(RN.Share.share).toHaveBeenLastCalledWith({ message: url, url });
}
test('URL builders only produce validated production track/creator URLs', () => {
    expect(publicTrackUrl(slug)).toBe(`https://veyrnox.ai/music/tracks/${slug}`);
    expect(publicCreatorUrl('artist_one')).toBe('https://veyrnox.ai/music/creators/artist_one');
    for (const value of ['', '../..', 'A'.repeat(24), 'a'.repeat(23), 'a'.repeat(25), `${slug}?x=1`, `${slug}/extra`]) expect(() => publicTrackUrl(value)).toThrow();
    for (const value of ['', 'ab', 'Artist', '1abc', 'a'.repeat(31), 'artist?x=1', 'artist/extra']) expect(() => publicCreatorUrl(value)).toThrow();
});
test('track share control invokes the exact URL', () => share(<MusicLinkShare slug={slug} />, 'musicPublication.shareTrack', `https://veyrnox.ai/music/tracks/${slug}`));
test('creator share control invokes the exact URL', () => share(<MusicLinkShare handle="artist_one" />, 'musicPublication.shareCreator', 'https://veyrnox.ai/music/creators/artist_one'));
test('share sheet failure uses button-neutral copy and clears after retry', async () => {
    jest.mocked(RN.Share.share).mockRejectedValueOnce(new Error('unavailable'));
    await share(<MusicLinkShare slug={slug} />, 'musicPublication.shareTrack', `https://veyrnox.ai/music/tracks/${slug}`);
    expect(root.container.queryAll(n => n.children.includes(t('musicPublication.shareSheetError')))).toHaveLength(1);
    expect(root.container.queryAll(n => n.children.includes(t('music.shareSheetError')))).toHaveLength(0);
    await share(<MusicLinkShare slug={slug} />, 'musicPublication.shareTrack', `https://veyrnox.ai/music/tracks/${slug}`);
    expect(root.container.queryAll(n => n.children.includes(t('musicPublication.shareSheetError')))).toHaveLength(0);
});
test('own publication track button invokes the exact URL', () => share(<MusicPublication song={detail} />, 'musicPublication.shareTrack', `https://veyrnox.ai/music/tracks/${publication.slug}`));
test('own publication profile button invokes the exact URL', () => share(<MusicPublication song={detail} />, 'musicPublication.shareCreator', `https://veyrnox.ai/music/creators/${publication.handle}`));
test('P4b track screen invokes the exact URL', () => share(<Track />, 'musicPublication.shareTrack', `https://veyrnox.ai/music/tracks/${slug}`));
test('P4b creator screen invokes the exact URL', () => share(<Creator />, 'musicPublication.shareCreator', `https://veyrnox.ai/music/creators/${creator.handle}`));

test.each(['track', 'creator'])('%s opened link preserves unavailable and gone states', async kind => {
    const view = kind === 'track' ? <Track /> : <Creator />;
    mockApi.request.mockRejectedValue(new ApiError(404, 'blocks_unavailable'));
    await act(async () => root.render(view));
    expect(root.container.queryAll(n => n.children.includes(t('musicPublic.unavailable'))).length).toBeGreaterThan(0);
    expect(root.container.queryAll(n => n.props.accessibilityLabel === t('musicPublication.shareTrack') || n.props.accessibilityLabel === t('musicPublication.shareCreator'))).toHaveLength(0);
    await act(async () => root.unmount()); root = createRoot();
    mockApi.request.mockImplementation(async (path: string) => { if (path.endsWith('/blocks')) return { blocks: [] }; throw new ApiError(404, 'not_found'); });
    await act(async () => root.render(view));
    expect(root.container.queryAll(n => n.children.includes(t('musicPublic.gone'))).length).toBeGreaterThan(0);
});
test.each(['track', 'creator'])('%s opened link preserves the blocked creator state', async kind => {
    mockApi.request.mockImplementation(async (path: string) => path.endsWith('/blocks') ? { blocks: [] } : { blocked: { creator_id: creator.creator_id, display_name: creator.display_name } });
    await act(async () => root.render(kind === 'track' ? <Track /> : <Creator />));
    expect(root.container.queryAll(n => n.children.includes(t('musicPublic.blockedState', { name: creator.display_name }))).length).toBeGreaterThan(0);
    expect(root.container.queryAll(n => n.props.accessibilityLabel === t('musicPublication.shareTrack') || n.props.accessibilityLabel === t('musicPublication.shareCreator'))).toHaveLength(0);
});
