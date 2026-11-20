import { isBestOf, isComments, isCounts, isProfilePage, isSocial, isTrackPage, publicDate } from '../src/lib/music/validatePublic';
import { isBlocked, isBlockList, isBlockReceipt } from '../src/lib/music/validateBlocks';
import { track, profile, best, comments, social, slug, actor, date, clone } from './fixtures/musicPublic';
function corrupt(input: unknown, path: string, value: unknown) {
    const v = clone(input) as any, keys = path.split('.'); let target = v;
    for (const key of keys.slice(0, -1)) target = target[key]; target[keys.at(-1)!] = value; return v;
}
test('complete projection fixtures and all absent optional sections are valid', () => {
    expect(isTrackPage(track, slug)).toBe(true); expect(isTrackPage({ track: track.track }, slug)).toBe(true);
    expect(isProfilePage(profile)).toBe(true); expect(isBestOf(best)).toBe(true); expect(isComments(comments)).toBe(true);
    expect(isSocial(social)).toBe(true); expect(isCounts(social)).toBe(true);
    expect(publicDate(date)).toBe(true); expect(publicDate('2026-02-30T00:00:00Z')).toBe(false);
});
test.each([
    ['track.creator_id', 'bad'], ['track.handle', 'Bad'], ['track.display_name', 'x'.repeat(81)], ['track.title', 'x'.repeat(121)],
    ['track.version_number', 0], ['track.published_at', 'tomorrow'], ['track.allow_comments', 1], ['track.allow_remixes', null],
    ['track.commercial_status', 'free'], ['track.audio_url', 'https://secret.test/asset'], ['lyrics', null], ['plays.count', -1],
    ['reports.open', false], ['social.reactions.fire', 0.1], ['social.follower_count', -1], ['rails.by_creator', null],
    ['rails.similar', [null]], ['comments', null], ['track.job_id', actor],
])('rejects malformed promised track field %s', (path, value) => expect(isTrackPage(corrupt(track, path, value), slug)).toBe(false));
test.each(['creator_id', 'handle', 'display_name', 'title', 'version_number', 'published_at', 'allow_comments', 'allow_remixes', 'commercial_status', 'audio_url'])('requires track.%s', field => {
    const v = clone(track) as any; delete v.track[field]; expect(isTrackPage(v, slug)).toBe(false);
});
test.each([
    ['allow_comments', 'true'], ['next_cursor', 'bad'], ['comments', null], ['own_comments', null],
    ['comments.0.id', 'bad'], ['comments.0.author_id', undefined], ['comments.0.parent_id', 'bad'], ['comments.0.body', ''],
    ['comments.0.at_seconds', 601], ['comments.0.created_at', 'bad'], ['comments.0.author', ''], ['comments.0.is_creator', 1], ['comments.0.own', 1],
    ['own_comments.0.id', 'bad'], ['own_comments.0.parent_id', 'bad'], ['own_comments.0.body', 'x'.repeat(1001)], ['own_comments.0.status', 'approved'], ['own_comments.0.created_at', null],
])('fails closed on comment field %s', (path, value) => expect(isComments(corrupt(comments, path, value))).toBe(false));
test.each(['fire', 'love', 'wow', 'praise', 'like', 'cool', 'hot'])('validates reaction %s', key => {
    expect(isCounts(corrupt(social, `reactions.${key}`, -1))).toBe(false);
    const v = clone(social) as any; delete v.reactions[key]; expect(isCounts(v)).toBe(false);
});
test.each([['my_reaction', 'bad'], ['following', 1], ['is_own', null], ['reactions.extra', 0]])('validates social %s', (path, value) => expect(isSocial(corrupt(social, path, value))).toBe(false));
test.each([['profile.creator_id', 'bad'], ['profile.handle', 'bad handle'], ['profile.display_name', null], ['tracks.0.slug', 'bad'], ['tracks.0.title', null],
    ['tracks.0.published_at', null], ['tracks.0.commercial_status', 'bad'], ['tracks.0.creator_id', 'bad'], ['social', null]])('validates profile %s', (path, value) => expect(isProfilePage(corrupt(profile, path, value))).toBe(false));
test.each([['playlists', null], ['playlists.0.genre', 'unknown'], ['playlists.0.tracks', Array(9).fill(best.playlists[0].tracks[0])],
    ['playlists.0.tracks.0.creator_id', 'bad'], ['playlists.0.tracks.0.slug', 'bad'], ['playlists.0.tracks.0.title', null],
    ['playlists.0.tracks.0.handle', 'BAD'], ['playlists.0.tracks.0.display_name', null]])('validates best of %s', (path, value) => expect(isBestOf(corrupt(best, path, value))).toBe(false));
test('blocked envelope excludes every content field', () => {
    const blocked = { blocked: { creator_id: actor, display_name: 'Creator' } };
    expect(isBlocked(blocked)).toBe(true); expect(isBlocked({ ...blocked, track: track.track })).toBe(false);
    expect(isBlocked(corrupt(blocked, 'blocked.creator_id', 'bad'))).toBe(false); expect(isBlocked(corrupt(blocked, 'blocked.display_name', null))).toBe(false);
});
test('validates every block list and receipt field, including replay', () => {
    const list = { blocks: [{ actor_id: actor, display_name: 'Creator', created_at: date }] };
    expect(isBlockList(list)).toBe(true);
    for (const field of ['actor_id', 'display_name', 'created_at']) expect(isBlockList(corrupt(list, `blocks.0.${field}`, null))).toBe(false);
    expect(isBlockList({ blocks: [...list.blocks, ...list.blocks] })).toBe(false);
    for (const blocked of [false, true]) for (const already of [false, true]) {
        const receipt = { actor_id: actor, blocked, already }; expect(isBlockReceipt(receipt, actor, blocked)).toBe(true);
        for (const field of ['actor_id', 'blocked', 'already']) expect(isBlockReceipt({ ...receipt, [field]: null }, actor, blocked)).toBe(false);
    }
});
