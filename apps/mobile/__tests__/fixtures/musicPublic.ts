import type { BestOf, Comments, ProfilePage, Social, TrackPage } from '../../src/lib/music/publicTypes';
export const actor = '11111111-1111-4111-8111-111111111111', commenter = '22222222-2222-4222-8222-222222222222';
export const commentId = '33333333-3333-4333-8333-333333333333', nextId = '44444444-4444-4444-8444-444444444444';
export const slug = '1234567890abcdef12345678', date = '2026-11-20T12:30:45.123456+00:00';
export const creator = { creator_id: actor, handle: 'creator_one', display_name: 'Creator One' };
export const social: Social = { reactions: { fire: 1, love: 2, wow: 0, praise: 0, like: 0, cool: 0, hot: 0 }, follower_count: 4, my_reaction: null, following: false, is_own: false };
export const comments: Comments = { allow_comments: true, next_cursor: nextId, comments: [
    { id: commentId, author_id: commenter, parent_id: null, body: 'Lovely music', at_seconds: 12.5, created_at: date, author: 'Listener', is_creator: false, own: false },
], own_comments: [{ id: nextId, parent_id: null, body: 'Awaiting review', status: 'pending', created_at: date }] };
export const track: TrackPage = { track: { ...creator, title: 'First track', version_number: 1, published_at: date, allow_comments: true,
    allow_remixes: false, commercial_status: 'personal_use_only', audio_url: `/api/music/public/${slug}/asset` },
    lyrics: 'A line of lyrics', plays: { count: 7 }, reports: { open: true }, social, comments,
    rails: { by_creator: [{ ...creator, slug, title: 'Another song' }], similar: [] } };
export const best: BestOf = { playlists: [{ genre: 'pop', tracks: [{ ...creator, slug, title: 'First track' }] }] };
export const profile: ProfilePage = { profile: creator, tracks: [{ creator_id: actor, slug, title: 'First track', published_at: date, commercial_status: 'personal_use_only' }], social };
export const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));
export { deferred } from './musicPlaylists';
