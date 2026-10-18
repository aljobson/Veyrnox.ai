// Stale-while-revalidate store for the few reads that make the app usable offline: balance, the Library list and
// the model catalog. Nothing else is cached, and nothing the screen does not already show. Cleared on sign-out and
// on account deletion. Paid actions never go through here.

export interface CacheStorage {
    get(key: string): Promise<string | null>;
    set(key: string, value: string): Promise<void>;
    remove(key: string): Promise<void>;
    keys(): Promise<string[]>;
}

export function createMemoryStorage(): CacheStorage {
    const map = new Map<string, string>();
    return {
        get: async (key) => map.get(key) ?? null,
        set: async (key, value) => void map.set(key, value),
        remove: async (key) => void map.delete(key),
        keys: async () => [...map.keys()],
    };
}

export interface CachePolicy {
    readonly name: string;
    // Whether the value belongs to one person (keyed by user id) or is the same public data for everyone.
    readonly perUser: boolean;
    // Younger than this: used as it is, no refetch.
    readonly freshMs: number;
    // Older than this: discarded unread. Past freshMs but under this, shown labelled stale while a refetch runs.
    readonly maxAgeMs: number;
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

export const POLICIES = {
    balance: { name: 'balance', perUser: true, freshMs: 30_000, maxAgeMs: DAY },
    library: { name: 'library', perUser: true, freshMs: MINUTE, maxAgeMs: 7 * DAY },
    catalog: { name: 'catalog', perUser: false, freshMs: 10 * MINUTE, maxAgeMs: 7 * DAY },
} as const satisfies Record<string, CachePolicy>;

export interface CacheMeta {
    // True when the value came from the saved copy; false once the network has confirmed it.
    readonly fromCache: boolean;
    // Saved copy older than freshMs. Label it as saved, not live.
    readonly stale: boolean;
    readonly savedAt: number;
    readonly ageMs: number;
}

export interface SwrOptions<T> {
    readonly policy: CachePolicy;
    readonly userId?: string;
    readonly fetcher: () => Promise<T>;
    // Called with the saved copy first (when there is one), then with the fresh value.
    readonly onData?: (value: T, meta: CacheMeta) => void;
}

const PREFIX = 'veyrnox.cache.v1.';

interface Stored {
    readonly savedAt: number;
    readonly value: unknown;
}

export interface Cache {
    swr<T>(options: SwrOptions<T>): Promise<{ readonly value: T; readonly meta: CacheMeta }>;
    read<T>(policy: CachePolicy, userId?: string): Promise<{ readonly value: T; readonly meta: CacheMeta } | null>;
    write<T>(policy: CachePolicy, value: T, userId?: string): Promise<void>;
    // Removes every saved copy. Called on sign-out and on account deletion.
    clear(): Promise<void>;
}

export function createCache(storage: CacheStorage, now: () => number = Date.now): Cache {
    function keyFor(policy: CachePolicy, userId?: string): string | null {
        if (!policy.perUser) return `${PREFIX}${policy.name}`;
        // A per-user entry with no user would be shared between accounts: refuse it.
        return userId ? `${PREFIX}${policy.name}.${userId}` : null;
    }

    async function read<T>(policy: CachePolicy, userId?: string) {
        const key = keyFor(policy, userId);
        if (!key) return null;
        let raw: string | null;
        try {
            raw = await storage.get(key);
        } catch {
            return null;
        }
        if (raw === null) return null;
        let stored: Stored;
        try {
            stored = JSON.parse(raw) as Stored;
        } catch {
            await storage.remove(key).catch(() => undefined);
            return null;
        }
        const ageMs = now() - stored.savedAt;
        if (typeof stored.savedAt !== 'number' || ageMs < 0 || ageMs > policy.maxAgeMs) {
            await storage.remove(key).catch(() => undefined);
            return null;
        }
        const meta: CacheMeta = { fromCache: true, stale: ageMs > policy.freshMs, savedAt: stored.savedAt, ageMs };
        return { value: stored.value as T, meta };
    }

    async function write<T>(policy: CachePolicy, value: T, userId?: string) {
        const key = keyFor(policy, userId);
        if (!key) return;
        const stored: Stored = { savedAt: now(), value };
        // A full or unavailable disk must never break the screen that has live data.
        await storage.set(key, JSON.stringify(stored)).catch(() => undefined);
    }

    async function swr<T>({ policy, userId, fetcher, onData }: SwrOptions<T>) {
        const saved = await read<T>(policy, userId);
        if (saved) {
            onData?.(saved.value, saved.meta);
            if (!saved.meta.stale) return saved;
        }
        try {
            const value = await fetcher();
            await write(policy, value, userId);
            const meta: CacheMeta = { fromCache: false, stale: false, savedAt: now(), ageMs: 0 };
            onData?.(value, meta);
            return { value, meta };
        } catch (err) {
            // Offline or failing server: keep showing the saved copy, labelled. With no copy the error is the caller's.
            if (saved) return saved;
            throw err;
        }
    }

    async function clear() {
        const keys = await storage.keys().catch(() => [] as string[]);
        await Promise.all(keys.filter((k) => k.startsWith(PREFIX)).map((k) => storage.remove(k).catch(() => undefined)));
    }

    return { swr, read, write, clear };
}
