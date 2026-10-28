import { API_BASE, ApiError, type ApiClient } from './api';
import { posterUrl, type CinemaTitle, type ContentType, type Episode, type TitleDetail } from './cinema';
import { type LockReason } from './cinemaBrowse';
import { listTitles } from './cinemaDrafts';
import { commentsErrorKey, fetchComments, type Comment } from './cinemaComments';
import { t } from './i18n';

// Pinned web copy; cinemaViewer.test.ts checks drift against cinemaPosters.js.
export const CURATED_POSTERS: Readonly<Record<string, string>> = Object.freeze({
    '5cc7db34-2b81-4eb2-83bf-7e52ff650b07': '/cinema/posters/painting-with-the-breeze.jpg',
    'b41362d4-b6a0-46ad-b0ab-d4e00ceb8d68': '/cinema/posters/late-afternoon-swans.jpg',
    '6138d6ab-35ba-48f5-934f-f8da387d2d45': '/cinema/posters/grey-haired-cafe-veo3.jpg',
    'c928cfef-ed3a-4560-afbf-ff72927eaa32': '/cinema/posters/visual-kei-lemonade-veo3.jpg',
});
export function posterSources(id: string): string[] {
    const key = id.toLowerCase();
    const curated = Object.prototype.hasOwnProperty.call(CURATED_POSTERS, key) ? CURATED_POSTERS[key] : null;
    return [...(curated ? [API_BASE + curated] : []), posterUrl(id)];
}
export function discoveryTarget(title: CinemaTitle) {
    return title.contentType === 'EPISODE'
        ? { pathname: '/cinema/watch/[id]' as const, params: { id: title.id, title: title.title, series: title.rootId! } }
        : { pathname: '/cinema/[id]' as const, params: { id: title.id } };
}
export function nextCandidate(detail: TitleDetail, currentId: string, locks: ReadonlyMap<string, LockReason | null>): Episode | null {
    const episodes = [...detail.episodes].sort((a, b) => a.season - b.season || a.position - b.position);
    const index = episodes.findIndex(e => e.id === currentId);
    const next = index < 0 ? null : episodes[index + 1];
    return next && locks.get(next.id) === null ? next : null;
}
export function typeLabel(type: ContentType): string {
    switch (type) {
        case 'FILM': return t('cinema.type.FILM');
        case 'SHORT': return t('cinema.type.SHORT');
        case 'TRAILER': return t('cinema.type.TRAILER');
        case 'SERIES': return t('cinemaBrowse.tab.series');
        case 'EPISODE': return t('cinema.episode');
    }
}
export function accessLabel(episode: Episode): string | null {
    switch (episode.access) {
        case 'free': return t('cinemaViewer.access.free');
    }
    switch (episode.reason) {
        case 'pass_ceiling': return t('cinemaViewer.access.passLimit');
        default: return null;
    }
}
export async function creatorAnalyticsOpen(api: Pick<ApiClient, 'request'>): Promise<boolean> {
    try { await api.request('/api/v1/cinema/creator-analytics'); }
    catch (err) { return err instanceof ApiError && err.status === 400 && err.code === 'invalid_query'; }
    return false;
}
export async function ownPublishedTitles(api: Pick<ApiClient, 'request'>) {
    const { content } = await listTitles(api);
    return content.filter(title => {
        const row = title as typeof title & { visibility?: string; parent_id?: string | null };
        return row.lifecycle_status === 'PUBLISHED' && row.visibility === 'PUBLIC' && !row.parent_id;
    });
}
export type CommentsPreviewResult = { kind: 'ok'; comments: Comment[] } | { kind: 'hidden' } | { kind: 'error'; key: string };
export async function commentsPreview(api: ApiClient, id: string): Promise<CommentsPreviewResult> {
    try { return { kind: 'ok', comments: (await fetchComments(api, id)).comments.slice(0, 2) }; }
    catch (err) {
        if (err instanceof ApiError && [403, 404, 503].includes(err.status)) return { kind: 'hidden' };
        return { kind: 'error', key: commentsErrorKey(err) };
    }
}
