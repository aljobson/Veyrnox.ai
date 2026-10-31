import { accountHandoffStore } from './accountHandoffStore';
import { isUuid } from './cinemaSocial';
import type { ProgressClient, ProgressItem } from './cinemaProgress';

const roots = accountHandoffStore<{ id: string; root: string }>('cinema-roots', 200);
export function rememberEpisodeRoot(id: string, root: string) {
    return isUuid(id) && isUuid(root) && id !== root ? roots.put({ id, root }) : Promise.resolve();
}
export function resumePosition(position: number, duration: number): number {
    return Number.isFinite(position) && position > 0 && duration > 0 && position < duration * 0.95 && duration - position > 5 ? position : 0;
}
export async function continueWatchingHref(item: ProgressItem) {
    const root = (await roots.list()).find(r => r.id === item.contentId)?.root;
    return { pathname: '/cinema/watch/[id]' as const, params: { id: item.contentId, title: item.title,
        position: String(resumePosition(item.position, item.duration)), ...(root ? { series: root } : {}) } };
}
export async function savedWatchPosition(client: Pick<ProgressClient, 'list'>, id: string, current: () => boolean): Promise<number> {
    let expired = false, timer: ReturnType<typeof setTimeout> | undefined;
    const lookup = async () => {
        let cursor: string | null = null;
        const seen = new Set<string>();
        try {
            do {
                if (expired || !current()) return 0;
                const page = await client.list(cursor);
                if (expired || !current()) return 0;
                const item = page.items.find(i => i.contentId === id);
                if (item) return resumePosition(item.position, item.duration);
                cursor = page.next;
                if (cursor && seen.has(cursor)) break;
                if (cursor) seen.add(cursor);
            } while (cursor);
        } catch { /* A closed progress feature must not block playback. */ }
        return 0;
    };
    try {
        return await Promise.race([lookup(), new Promise<number>(resolve => { timer = setTimeout(() => resolve(0), 1500); })]);
    } finally { expired = true; clearTimeout(timer); }
}
