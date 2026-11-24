let cacheOwner: string | undefined = 'account-a';
const cacheListeners = new Set<() => void>();
jest.mock('../src/lib/appCache', () => ({
    getCacheUser: () => cacheOwner,
    subscribeCacheUser: (listener: () => void) => { cacheListeners.add(listener); return () => cacheListeners.delete(listener); },
    userDocStorage: { get: async () => null, set: async () => undefined, remove: async () => undefined, keys: async () => [] },
}));

import { createMemoryStorage, type CacheStorage } from '../src/lib/cache';
import {
    cleanPersistentAudioQueueEntry, createPersistentAudioQueueStore, purgeOwnedPersistentAudioQueue, sanitizePersistentAudioQueue,
    visiblePersistentAudioQueue,
    type AudioQueueEnvelope,
} from '../src/lib/music/persistentAudioQueue';

const publicEntry = { type: 'public_slug' as const, slug: 'a'.repeat(24), title: 'Public song', displayName: 'Creator' };
const ownedEntry = { type: 'owned_asset' as const, jobId: '12345678-1234-1234-1234-1234567890ab', title: 'Owned song', source: 'music' as const,
    songId: 'abcdefab-1234-1234-1234-abcdefabcdef' };
const envelope = (owner = 'account-a'): AudioQueueEnvelope => ({ version: 2, owner, queue: [publicEntry, ownedEntry], index: 1 });

beforeEach(() => { cacheOwner = 'account-a'; });

test('mobile queue schema rejects URLs, unknown fields and malformed ids', () => {
    expect(cleanPersistentAudioQueueEntry(publicEntry)).toEqual(publicEntry);
    expect(cleanPersistentAudioQueueEntry({ ...ownedEntry, url: 'https://signed.example/file' })).toBeNull();
    expect(cleanPersistentAudioQueueEntry({ ...ownedEntry, jobId: 'not-a-uuid' })).toBeNull();
    expect(cleanPersistentAudioQueueEntry({ ...ownedEntry, source: 'other' })).toBeNull();
    const many = Array.from({ length: 40 }, (_, index) => ({ ...publicEntry, slug: index.toString(16).padStart(24, '0') }));
    const clean = sanitizePersistentAudioQueue({ version: 2, owner: 'account-a', queue: [many[0], many[0], ...many], index: 99 }, 'account-a');
    expect(clean.queue).toHaveLength(30);
    expect(new Set(clean.queue.map(row => row.type === 'public_slug' ? row.slug : row.jobId)).size).toBe(30);
    expect(JSON.stringify(clean)).not.toContain('http');
});

test('owner mismatch returns an empty account envelope', () => {
    expect(sanitizePersistentAudioQueue(envelope('account-a'), 'account-b')).toEqual({ version: 2, owner: 'account-b', queue: [], index: 0 });
});

test('store reads and writes only the current owner document', async () => {
    const storage = createMemoryStorage(), store = createPersistentAudioQueueStore(storage, () => cacheOwner);
    expect(await store.save('account-a', envelope())).toBe(true);
    expect(await store.load('account-a')).toEqual(envelope());
    cacheOwner = 'account-b'; store.ownerChanged();
    expect(await store.load('account-a')).toBeNull();
    expect(await store.load('account-b')).toEqual({ version: 2, owner: 'account-b', queue: [], index: 0 });
});

test('an A read finishing after B becomes current cannot publish', async () => {
    let release!: (value: string | null) => void;
    const storage: CacheStorage = { get: () => new Promise(resolve => { release = resolve; }), set: async () => undefined, remove: async () => undefined, keys: async () => [] };
    const store = createPersistentAudioQueueStore(storage, () => cacheOwner);
    const pending = store.load('account-a');
    cacheOwner = 'account-b'; store.ownerChanged(); release(JSON.stringify(envelope()));
    await expect(pending).resolves.toBeNull();
});

test('a stale A write cannot be mistaken for B state', async () => {
    let release!: () => void; const values = new Map<string, string>();
    const storage: CacheStorage = {
        get: async key => values.get(key) ?? null,
        set: async (key, value) => { await new Promise<void>(resolve => { release = resolve; }); values.set(key, value); },
        remove: async key => void values.delete(key), keys: async () => [...values.keys()],
    };
    const store = createPersistentAudioQueueStore(storage, () => cacheOwner);
    const pending = store.save('account-a', envelope());
    cacheOwner = 'account-b'; store.ownerChanged(); release();
    await expect(pending).resolves.toBe(false);
    expect(values.size).toBe(0);
    await expect(store.load('account-b')).resolves.toEqual({ version: 2, owner: 'account-b', queue: [], index: 0 });
});

test('explicit feature-off purge keeps public rows and removes owned rows', async () => {
    const storage = createMemoryStorage(), store = createPersistentAudioQueueStore(storage, () => cacheOwner);
    const clean = await store.purgeOwned('account-a', envelope());
    expect(clean.queue).toEqual([publicEntry]);
    expect(clean.index).toBe(0);
    await expect(store.load('account-a')).resolves.toEqual(clean);
});

test('an unknown entitlement hides owned playback without deleting its saved envelope', () => {
    const saved = envelope();
    expect(visiblePersistentAudioQueue(saved, 'unknown')).toEqual([]);
    expect(saved.queue).toEqual([publicEntry, ownedEntry]);
    expect(purgeOwnedPersistentAudioQueue(saved).queue).toEqual([publicEntry]);
});
