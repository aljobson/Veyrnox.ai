import { ApiError } from './api';
import type { mediaApi } from './media';

export type AssetLink = { kind: 'file'; url: string; mime: string; expiresAt: string | null }
    | { kind: 'held' } | { kind: 'cooldown'; until: number } | { kind: 'none' };
type Options = { getAsset: ReturnType<typeof mediaApi>['getAsset']; now?: () => number; ttlMs?: number; concurrency?: number };

// Signed URLs never leave this memory cache. A generation invalidates even already-sent work on clear.
export function createAssetLinks({ getAsset, now = Date.now, ttlMs = 12 * 60_000, concurrency = 3 }: Options) {
    const cache = new Map<string, { at: number; value: AssetLink }>();
    const pending = new Map<string, Promise<AssetLink>>();
    const queue: { id: string; epoch: number; resolve: (value: AssetLink) => void }[] = [];
    let active = 0, epoch = 0, until = 0;
    const peek = (id: string): AssetLink | undefined => {
        const entry = cache.get(id);
        if (entry && now() - entry.at < ttlMs) return entry.value;
        cache.delete(id);
    };
    function drain() {
        while (queue.length && (now() < until || active < Math.max(1, concurrency))) {
            const task = queue.shift()!;
            if (now() < until) { task.resolve({ kind: 'cooldown', until }); continue; }
            active++;
            void (async () => {
                let value: AssetLink;
                try {
                    const asset = await getAsset(task.id);
                    value = { kind: 'file', url: asset.url, mime: asset.mime_type, expiresAt: asset.asset_expires_at ?? null };
                } catch (err) {
                    value = err instanceof ApiError && err.code === 'held' ? { kind: 'held' } : { kind: 'none' };
                    if (task.epoch === epoch && err instanceof ApiError && err.status === 429) {
                        until = Math.max(until, now() + (err.retryAfterSeconds ?? 60) * 1000);
                    }
                }
                if (task.epoch !== epoch) value = { kind: 'none' };
                else if (value.kind === 'file' || value.kind === 'held') cache.set(task.id, { at: now(), value });
                task.resolve(value);
                active--;
                drain();
            })();
        }
    }
    return {
        peek,
        request(id: string): Promise<AssetLink> {
            const existing = pending.get(id);
            if (existing) return existing;
            if (now() < until) return Promise.resolve({ kind: 'cooldown', until });
            const cached = peek(id);
            if (cached) return Promise.resolve(cached);
            const promise = new Promise<AssetLink>(resolve => queue.push({ id, epoch, resolve }));
            pending.set(id, promise);
            void promise.then(() => { if (pending.get(id) === promise) pending.delete(id); });
            drain();
            return promise;
        },
        clear() {
            epoch++; until = 0; cache.clear(); pending.clear();
            queue.splice(0).forEach(task => task.resolve({ kind: 'none' }));
        },
    };
}
