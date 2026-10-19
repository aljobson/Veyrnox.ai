import { API_BASE } from './api';
import { isUsername } from './cinemaBlocks';

// Cinema catalogue reads (ADR-0059). The list is anonymous and cached by the server for a minute;
// the per-title read under /api/v1 adds what this viewer may watch, episode by episode.
const PAGE_SIZE = 24;

export type ContentType = 'FILM' | 'SHORT' | 'TRAILER' | 'SERIES';

export interface CinemaTitle {
    readonly id: string;
    readonly contentType: ContentType;
    readonly title: string;
    readonly synopsis: string;
    readonly creator: string;
    // The creator's public handle, kept only when it is a valid username: it is what Block needs (ADR-0141).
    readonly creatorUsername: string | null;
    readonly episodeCount: number;
    readonly durationSeconds: number | null;
    readonly publishedAt: string;
}

export interface Cursor {
    readonly before: string;
    readonly beforeId: string;
}

export interface TitlesPage {
    readonly titles: readonly CinemaTitle[];
    readonly next: Cursor | null;
}

export interface Episode {
    readonly id: string;
    readonly title: string;
    readonly season: number;
    readonly position: number;
    readonly durationSeconds: number | null;
    readonly watchable: boolean;
}

export interface TitleDetail {
    readonly title: CinemaTitle;
    // A film or short is itself the thing to play; a series lists its episodes.
    readonly watchable: boolean;
    readonly episodes: readonly Episode[];
}

type Raw = Record<string, unknown>;
const isObject = (v: unknown): v is Raw => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown, fallback = ''): string => (typeof v === 'string' ? v : fallback);
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const TYPES: readonly string[] = ['FILM', 'SHORT', 'TRAILER', 'SERIES'];

function parseTitle(raw: unknown): CinemaTitle | null {
    if (!isObject(raw) || typeof raw.id !== 'string' || !TYPES.includes(str(raw.content_type))) return null;
    const creator = isObject(raw.creator) ? raw.creator : raw;
    return {
        id: raw.id,
        contentType: raw.content_type as ContentType,
        title: str(raw.title, 'Untitled'),
        synopsis: str(raw.synopsis),
        creator: str(creator.display_name) || str(creator.username),
        creatorUsername: isUsername(creator.username) ? creator.username : null,
        episodeCount: num(raw.episode_count) ?? 0,
        durationSeconds: num(raw.duration_seconds),
        publishedAt: str(raw.published_at),
    };
}

export function parseTitlesPage(body: unknown): TitlesPage {
    if (!isObject(body) || !Array.isArray(body.titles)) return { titles: [], next: null };
    const titles = body.titles.map(parseTitle).filter((t): t is CinemaTitle => t !== null);
    const next = typeof body.next === 'string' && typeof body.next_id === 'string' ? { before: body.next, beforeId: body.next_id } : null;
    return { titles, next };
}

export function titlesUrl(cursor: Cursor | null, base: string = API_BASE): string {
    const q = [`limit=${PAGE_SIZE}`];
    if (cursor) q.push(`before=${encodeURIComponent(cursor.before)}`, `before_id=${encodeURIComponent(cursor.beforeId)}`);
    return `${base}/api/cinema/titles?${q.join('&')}`;
}

export async function fetchTitlesPage(cursor: Cursor | null, doFetch: typeof fetch = fetch, base: string = API_BASE): Promise<TitlesPage> {
    const res = await doFetch(titlesUrl(cursor, base));
    if (!res.ok) throw new Error(`titles_${res.status}`);
    return parseTitlesPage(await res.json());
}

export const posterUrl = (id: string, base: string = API_BASE): string => `${base}/api/cinema/posters/${encodeURIComponent(id)}`;

// Free viewing only (CINEMA_UNLOCKS_ENABLED is off): anything but a free title is shown as unavailable.
const isFree = (raw: unknown): boolean => isObject(raw) && raw.access === 'free';

export function parseTitleDetail(body: unknown): TitleDetail | null {
    if (!isObject(body)) return null;
    const raw = body.title;
    const title = parseTitle(raw);
    if (!title || !isObject(raw)) return null;
    const episodes: Episode[] = [];
    if (Array.isArray(raw.seasons)) {
        for (const s of raw.seasons) {
            if (!isObject(s) || !Array.isArray(s.episodes)) continue;
            for (const e of s.episodes) {
                if (!isObject(e) || typeof e.id !== 'string') continue;
                episodes.push({
                    id: e.id,
                    title: str(e.title, 'Episode'),
                    season: num(s.position) ?? 1,
                    position: num(e.position) ?? episodes.length + 1,
                    durationSeconds: num(e.duration_seconds),
                    watchable: isFree(e),
                });
            }
        }
    }
    return { title, watchable: title.contentType !== 'SERIES' && isFree(raw), episodes };
}

export function formatDuration(seconds: number | null): string {
    if (seconds === null || seconds <= 0) return '';
    const m = Math.floor(seconds / 60);
    const s = Math.round(seconds % 60);
    return `${m}:${String(s).padStart(2, '0')}`;
}
