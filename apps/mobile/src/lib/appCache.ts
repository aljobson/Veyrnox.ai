import { Directory, File, Paths } from 'expo-file-system';
import { createCache, type Cache, type CacheStorage } from './cache';

// The app's one cache: a small file per key under the private cache directory (the OS may reclaim it, which only
// costs a refetch). Library labels are personal data, so every per-user entry is keyed by user id and the whole
// cache is wiped when the user signs out, deletes the account, or a different user signs in.

const FILE_SUFFIX = '.json';
const USER_KEY = 'veyrnox.cache.v1.__user';

export function createFileStorage(dir: () => Directory): CacheStorage {
    const fileFor = (key: string) => new File(dir(), `${encodeURIComponent(key)}${FILE_SUFFIX}`);
    const ensureDir = () => {
        const d = dir();
        if (!d.exists) d.create({ intermediates: true, idempotent: true });
    };
    return {
        async get(key) {
            const file = fileFor(key);
            return file.exists ? file.text() : null;
        },
        async set(key, value) {
            ensureDir();
            const file = fileFor(key);
            if (!file.exists) file.create();
            await file.write(value);
        },
        async remove(key) {
            const file = fileFor(key);
            if (file.exists) file.delete();
        },
        async keys() {
            const d = dir();
            if (!d.exists) return [];
            return d
                .list()
                .filter((entry): entry is File => entry instanceof File && entry.name.endsWith(FILE_SUFFIX))
                .map((entry) => decodeURIComponent(entry.name.slice(0, -FILE_SUFFIX.length)));
        },
    };
}

export const appStorage: CacheStorage = createFileStorage(() => new Directory(Paths.cache, 'veyrnox-cache'));
export const appCache: Cache = createCache(appStorage);

// The user id is the `sub` claim of the access token. Read only to key the cache; the token is not checked here.
export function userIdFromToken(accessToken: string): string | null {
    const part = accessToken.split('.')[1];
    if (!part) return null;
    try {
        const json = atob(part.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(part.length / 4) * 4, '='));
        const sub = (JSON.parse(json) as { sub?: unknown }).sub;
        return typeof sub === 'string' && sub ? sub : null;
    } catch {
        return null;
    }
}

let activeUser: string | null = null;

export const getCacheUser = (): string | undefined => activeUser ?? undefined;

// Called when a session is adopted. A different user than last time (including one from a previous launch) wipes
// everything first.
export async function bindCacheUser(userId: string | null, cache: Cache = appCache, storage: CacheStorage = appStorage): Promise<void> {
    if (!userId) return;
    if (activeUser === userId) return;
    const last = activeUser ?? (await storage.get(USER_KEY).catch(() => null));
    if (last !== userId) await cache.clear();
    activeUser = userId;
    await storage.set(USER_KEY, userId).catch(() => undefined);
}

// Called when the session is dropped: sign-out, a lost session, or account deletion (which signs out).
export async function wipeCache(cache: Cache = appCache): Promise<void> {
    activeUser = null;
    await cache.clear();
}

// For tests.
export function resetCacheUser() {
    activeUser = null;
}
