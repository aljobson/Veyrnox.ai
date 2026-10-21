import { EDITORIAL_SERIES } from './cinemaEditorialData';
import { CATEGORIES, WEB_ORIGIN, parseEntitlement, type LockReason } from './cinemaBrowse';

export type EditorialSeries = typeof EDITORIAL_SERIES[number];
export function editorialSeriesList(category: string | null): readonly EditorialSeries[] {
    return category ? EDITORIAL_SERIES.filter(s => (s.categories as readonly string[]).includes(category)) : EDITORIAL_SERIES;
}
export function editorialSeriesBySlug(slug: string | undefined): EditorialSeries | null {
    return typeof slug === 'string' && /^[a-z0-9-]{1,80}$/.test(slug)
        ? EDITORIAL_SERIES.find(s => s.slug === slug) ?? null : null;
}
export function editorialSeriesWebUrl(slug: string): string | null {
    return editorialSeriesBySlug(slug) ? `${WEB_ORIGIN}/social-cinema/series/${encodeURIComponent(slug)}` : null;
}
export function editorialEpisodeWebUrl(slug: string, episodeId: string): string | null {
    const series = editorialSeriesBySlug(slug);
    return series?.episodes.some(e => e.id === episodeId)
        ? `${WEB_ORIGIN}/social-cinema/watch/${encodeURIComponent(episodeId)}?series=${encodeURIComponent(slug)}` : null;
}
export const phoneCategories = (list: readonly string[]): string[] => list.filter(slug => CATEGORIES.some(c => c.slug === slug));

type Raw = Record<string, unknown>;
const isObject = (value: unknown): value is Raw => typeof value === 'object' && value !== null && !Array.isArray(value);
export function episodeLock(raw: unknown): LockReason | null {
    if (isObject(raw) && raw.access === 'free') return null;
    const entitlement = parseEntitlement(raw);
    return entitlement.kind === 'locked' ? entitlement.reason : 'locked';
}
export function parseEpisodeLocks(body: unknown): ReadonlyMap<string, LockReason | null> {
    const locks = new Map<string, LockReason | null>();
    if (!isObject(body) || !isObject(body.title) || !Array.isArray(body.title.seasons)) return locks;
    for (const season of body.title.seasons) {
        if (!isObject(season) || !Array.isArray(season.episodes)) continue;
        for (const episode of season.episodes) {
            if (isObject(episode) && typeof episode.id === 'string') locks.set(episode.id, episodeLock(episode));
        }
    }
    return locks;
}
