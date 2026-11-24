import { getCacheUser, subscribeCacheUser, userDocStorage } from '../appCache';
import type { CacheStorage } from '../cache';

export const MOBILE_AUDIO_QUEUE_VERSION = 2 as const;
export const MOBILE_AUDIO_QUEUE_MAX = 30;
const PUBLIC_SLUG = /^[a-f0-9]{24}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const SOURCES = new Set(['music', 'speech', 'dialogue', 'audio_shelf']);

export type PublicQueueEntry = { type: 'public_slug'; slug: string; title: string; displayName: string };
export type OwnedQueueEntry = { type: 'owned_asset'; jobId: string; title: string; source: 'music' | 'speech' | 'dialogue' | 'audio_shelf'; songId?: string };
export type AudioQueueEntry = PublicQueueEntry | OwnedQueueEntry;
export type AudioQueueEnvelope = { version: 2; owner: string; queue: AudioQueueEntry[]; index: number };
export type PersistentQueueCapability = 'loading' | 'on' | 'off' | 'unknown';
export type PersistentAudioQueueStore = {
    ownerChanged(): void;
    load(owner: string): Promise<AudioQueueEnvelope | null>;
    save(owner: string, envelope: AudioQueueEnvelope): Promise<boolean>;
    purgeOwned(owner: string, envelope: AudioQueueEnvelope): Promise<AudioQueueEnvelope>;
};

const bounded = (value: unknown, max: number): string => typeof value === 'string' ? value.trim().slice(0, max) : '';
const ownKeys = (value: object, keys: readonly string[]): boolean => Object.keys(value).every(key => keys.includes(key));
export function cleanPersistentAudioQueueEntry(value: unknown): AudioQueueEntry | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const row = value as Record<string, unknown>;
    if (row.type === 'public_slug') {
        if (!ownKeys(row, ['type', 'slug', 'title', 'displayName']) || !PUBLIC_SLUG.test(bounded(row.slug, 24))) return null;
        const title = bounded(row.title, 120); if (!title) return null;
        return { type: 'public_slug', slug: bounded(row.slug, 24), title, displayName: bounded(row.displayName, 80) };
    }
    if (row.type === 'owned_asset') {
        if (!ownKeys(row, ['type', 'jobId', 'title', 'source', 'songId']) || !UUID.test(bounded(row.jobId, 36)) || !SOURCES.has(String(row.source))) return null;
        const title = bounded(row.title, 120); if (!title) return null;
        const songId = row.songId === undefined ? undefined : bounded(row.songId, 36).toLowerCase();
        if (songId !== undefined && !UUID.test(songId)) return null;
        return { type: 'owned_asset', jobId: bounded(row.jobId, 36).toLowerCase(), title,
            source: row.source as OwnedQueueEntry['source'], ...(songId ? { songId } : {}) };
    }
    return null;
}

const keyOf = (entry: AudioQueueEntry) => entry.type === 'public_slug' ? `public:${entry.slug}` : `owned:${entry.jobId}`;
export function sanitizePersistentAudioQueue(value: unknown, owner: string): AudioQueueEnvelope {
    const row = value && typeof value === 'object' ? value as Record<string, unknown> : {};
    const source = row.version === MOBILE_AUDIO_QUEUE_VERSION && row.owner === owner && Array.isArray(row.queue) ? row.queue : [];
    const seen = new Set<string>(), queue: AudioQueueEntry[] = [];
    for (const raw of source) {
        const entry = cleanPersistentAudioQueueEntry(raw); if (!entry) continue;
        const key = keyOf(entry); if (seen.has(key)) continue;
        seen.add(key); queue.push(entry); if (queue.length === MOBILE_AUDIO_QUEUE_MAX) break;
    }
    const index = typeof row.index === 'number' && Number.isInteger(row.index) && row.index >= 0 && row.index < queue.length ? row.index : 0;
    return { version: MOBILE_AUDIO_QUEUE_VERSION, owner, queue, index };
}

export function visiblePersistentAudioQueue(envelope: AudioQueueEnvelope, capability: PersistentQueueCapability): AudioQueueEntry[] {
    return capability === 'on' ? envelope.queue : [];
}

export function purgeOwnedPersistentAudioQueue(envelope: AudioQueueEnvelope): AudioQueueEnvelope {
    const queue = envelope.queue.filter((entry): entry is PublicQueueEntry => entry.type === 'public_slug');
    return sanitizePersistentAudioQueue({ ...envelope, queue, index: Math.min(envelope.index, Math.max(0, queue.length - 1)) }, envelope.owner);
}

const storageKey = (owner: string) => `veyrnox.audio.queue.v2.${encodeURIComponent(owner)}`;

export function createPersistentAudioQueueStore(storage: CacheStorage = userDocStorage, currentOwner: () => string | undefined = getCacheUser) {
    let generation = 0;
    let writes: Promise<void> = Promise.resolve();
    const store: PersistentAudioQueueStore = {
        ownerChanged() { generation += 1; },
        async load(owner: string): Promise<AudioQueueEnvelope | null> {
            const ticket = generation;
            if (!owner || currentOwner() !== owner) return null;
            let raw: string | null;
            try { raw = await storage.get(storageKey(owner)); } catch { return null; }
            if (ticket !== generation || currentOwner() !== owner) return null;
            try { return sanitizePersistentAudioQueue(JSON.parse(raw ?? 'null'), owner); }
            catch { return sanitizePersistentAudioQueue(null, owner); }
        },
        async save(owner: string, envelope: AudioQueueEnvelope): Promise<boolean> {
            const ticket = generation;
            if (!owner || currentOwner() !== owner) return false;
            const safe = sanitizePersistentAudioQueue(envelope, owner);
            const key = storageKey(owner), serialized = JSON.stringify(safe);
            const write = writes.then(async () => {
                if (ticket !== generation || currentOwner() !== owner) return false;
                try { await storage.set(key, serialized); }
                catch { return false; }
                if (ticket === generation && currentOwner() === owner) return true;
                await storage.remove(key).catch(() => undefined);
                return false;
            });
            writes = write.then(() => undefined, () => undefined);
            return write;
        },
        async purgeOwned(owner: string, envelope: AudioQueueEnvelope): Promise<AudioQueueEnvelope> {
            const safe = purgeOwnedPersistentAudioQueue(sanitizePersistentAudioQueue(envelope, owner));
            await store.save(owner, safe); return safe;
        },
    };
    return store;
}

export const persistentAudioQueueStore = createPersistentAudioQueueStore();
subscribeCacheUser(() => persistentAudioQueueStore.ownerChanged());
