import { appStorage, getCacheUser, subscribeCacheUser } from './appCache';
import type { CacheStorage } from './cache';

let epoch = 0;
let observing = false;
function observeOwner() { if (!observing) { observing = true; subscribeCacheUser(() => { epoch++; }); } }
export function captureHandoffOwner() {
    observeOwner();
    const owner = getCacheUser(), version = epoch;
    return () => !!owner && owner === getCacheUser() && version === epoch;
}
export function accountHandoffStore<T extends { id: string }>(name: string, limit: number, storage: CacheStorage = appStorage) {
    let tail: Promise<unknown> = Promise.resolve();
    const capture = () => {
        observeOwner();
        const owner = getCacheUser(), version = epoch;
        return { owner, key: `veyrnox.cache.v1.handoff-${name}.${owner}`, current: () => !!owner && owner === getCacheUser() && version === epoch };
    };
    async function read(c: ReturnType<typeof capture>): Promise<T[]> {
        if (!c.current()) return [];
        const raw = await storage.get(c.key);
        if (!c.current() || !raw) return [];
        let data;
        try { data = JSON.parse(raw); } catch { return []; }
        return data?.owner === c.owner && Array.isArray(data.items) ? data.items.filter((i: T) => i && typeof i.id === 'string').slice(-limit) : [];
    }
    function update(id: string, change: (item: T | undefined) => T | undefined): Promise<void> {
        const c = capture();
        const run = tail.then(async () => {
            const items = await read(c);
            if (!c.current()) return;
            const item = change(items.find(i => i.id === id));
            if (!item || !c.current()) return;
            await storage.set(c.key, JSON.stringify({ owner: c.owner, items: [...items.filter(i => i.id !== id), item].slice(-limit) }));
            if (!c.current()) await storage.remove(c.key);
        }).catch(() => undefined);
        tail = run;
        return run;
    }
    return {
        async list(): Promise<T[]> {
            const c = capture();
            await tail;
            return read(c).catch(() => []);
        },
        put: (item: T) => update(item.id, () => item),
        update,
    };
}
