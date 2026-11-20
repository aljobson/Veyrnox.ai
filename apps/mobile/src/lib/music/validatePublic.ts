import { isRecord } from '../responseShapes';
import { GENRES, REACTIONS, type BestOf, type Comments, type Counts, type ProfilePage, type RailTrack, type Social, type TrackPage } from './publicTypes';
export const publicUuid = (v: unknown): v is string => typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
export const publicSlug = (v: unknown): v is string => typeof v === 'string' && /^[a-f0-9]{24}$/.test(v);
export const publicHandle = (v: unknown): v is string => typeof v === 'string' && /^[a-z][a-z0-9_]{2,29}$/.test(v);
export const publicText = (v: unknown, max: number, min = 0): v is string => typeof v === 'string' && v.length <= max && v.trim().length >= min;
export const publicInteger = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;
export const publicKey = (v: unknown): v is string => typeof v === 'string' && /^[A-Za-z0-9._-]{8,120}$/.test(v);
export const exact = (v: Record<string, unknown>, keys: string[]) => Object.keys(v).length === keys.length && keys.every(k => k in v);
export function publicDate(v: unknown): v is string {
    if (typeof v !== 'string' || !/^\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,6})?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/.test(v)) return false;
    const [y, m, d] = v.slice(0, 10).split('-').map(Number);
    return d <= [31, y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1];
}
export const isCreator = (v: unknown) => isRecord(v) && publicUuid(v.creator_id) && publicHandle(v.handle) && publicText(v.display_name, 80, 1);
const commercial = (v: unknown) => v === 'personal_use_only' || v === 'plan_eligible_terms_apply';
export function isRailTrack(v: unknown): v is RailTrack { return isRecord(v) && isCreator(v) && publicSlug(v.slug) && publicText(v.title, 120); }
export function isCounts(v: unknown): v is Counts {
    return isRecord(v) && isRecord(v.reactions) && exact(v.reactions, [...REACTIONS])
        && REACTIONS.every(k => publicInteger((v.reactions as Record<string, unknown>)[k])) && publicInteger(v.follower_count);
}
export function isSocial(v: unknown): v is Social {
    if (!isRecord(v)) return false;
    const { my_reaction, following, is_own } = v;
    return isCounts(v) && (my_reaction === null || REACTIONS.includes(my_reaction as never))
        && typeof following === 'boolean' && typeof is_own === 'boolean';
}
const commentBase = (c: unknown) => isRecord(c) && publicUuid(c.id) && (c.parent_id === null || publicUuid(c.parent_id))
    && publicText(c.body, 1000, 1) && publicDate(c.created_at);
export function isComments(v: unknown): v is Comments {
    return isRecord(v) && typeof v.allow_comments === 'boolean' && Array.isArray(v.comments) && v.comments.length <= 25
        && v.comments.every(c => isRecord(c) && commentBase(c) && publicUuid(c.author_id)
            && (c.at_seconds === null || typeof c.at_seconds === 'number' && Number.isFinite(c.at_seconds) && c.at_seconds >= 0 && c.at_seconds <= 600)
            && publicText(c.author, 80, 1) && typeof c.is_creator === 'boolean' && typeof c.own === 'boolean')
        && (v.next_cursor === null || publicUuid(v.next_cursor)) && Array.isArray(v.own_comments) && v.own_comments.length <= 25
        && v.own_comments.every(c => isRecord(c) && commentBase(c) && (c.status === 'pending' || c.status === 'rejected'));
}
export function isTrackPage(v: unknown, slug: string): v is TrackPage {
    if (!isRecord(v) || !isRecord(v.track)) return false;
    const t = v.track;
    return !('blocked' in v) && isCreator(t) && publicText(t.title, 120) && publicInteger(t.version_number) && t.version_number > 0
        && publicDate(t.published_at) && typeof t.allow_comments === 'boolean' && typeof t.allow_remixes === 'boolean'
        && commercial(t.commercial_status) && t.audio_url === `/api/music/public/${slug}/asset`
        && !('job_id' in t) && (!('lyrics' in v) || publicText(v.lyrics, 3000, 1))
        && (!('plays' in v) || isRecord(v.plays) && publicInteger(v.plays.count))
        && (!('reports' in v) || isRecord(v.reports) && v.reports.open === true)
        && (!('social' in v) || isCounts(v.social)) && (!('comments' in v) || isComments(v.comments))
        && (!('rails' in v) || isRecord(v.rails) && ['by_creator', 'similar'].every(k => {
            const rows = (v.rails as Record<string, unknown>)[k]; return Array.isArray(rows) && rows.length <= 6 && rows.every(isRailTrack);
        }));
}
export function isProfilePage(v: unknown): v is ProfilePage {
    return isRecord(v) && !('blocked' in v) && isCreator(v.profile) && Array.isArray(v.tracks)
        && v.tracks.every(r => isRecord(r) && publicSlug(r.slug) && publicText(r.title, 120) && publicDate(r.published_at)
            && commercial(r.commercial_status) && publicUuid(r.creator_id) && isRecord(v.profile) && r.creator_id === v.profile.creator_id)
        && (!('social' in v) || isCounts(v.social));
}
export function isBestOf(v: unknown): v is BestOf {
    return isRecord(v) && Array.isArray(v.playlists) && v.playlists.length <= 12
        && new Set(v.playlists.map(p => p?.genre)).size === v.playlists.length
        && v.playlists.every(p => isRecord(p) && GENRES.includes(p.genre as never) && Array.isArray(p.tracks) && p.tracks.length <= 8 && p.tracks.every(isRailTrack));
}
