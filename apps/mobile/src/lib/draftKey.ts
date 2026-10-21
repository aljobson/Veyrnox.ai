import * as Crypto from 'expo-crypto';
import type { CacheStorage } from './cache';
import type { Draft } from './publishCompose';

// ADR-0122: the idempotency key of a Publish draft is saved before the post is sent, so closing or losing the app
// in the middle of a send cannot turn a retry into a second public post. It lives under the cache prefix, so the
// wipe that runs on sign-out, account deletion and a change of user removes it too. Never read by another account.

const PREFIX = 'veyrnox.cache.v1.publish-draft.';
const MAX_AGE_MS = 24 * 3_600_000;

interface Saved {
    readonly signature: string;
    readonly key: string;
    readonly createdAt: number;
}

// What would be posted: the creation, the accounts (in any order), the text and the time.
export function draftSignature(draft: Draft): string {
    return JSON.stringify([draft.uploadId ? `upload:${draft.uploadId}` : draft.jobId, draft.mediaType, [...draft.accountIds].sort(), draft.text.trim(), draft.queue ? `queue:${draft.queue.id}` : draft.when.kind === 'now' ? 'now' : draft.when.at.toISOString(), Object.entries(draft.networkText ?? {}).sort(([a], [b]) => (a < b ? -1 : 1)), draft.youtubeVisibility ?? null]);
}

// A 4xx the server decided on means nothing was created, so the key is finished. A lost connection, a timeout, a rate
// limit or any 5xx may have been created, so the key stays and a retry is safe.
export function isDefiniteRefusal(err: unknown): boolean {
    const status = (err as { status?: unknown } | null)?.status;
    return typeof status === 'number' && status >= 400 && status < 500 && status !== 408 && status !== 429;
}

export interface DraftKeys {
    keyFor(userId: string | undefined, signature: string): Promise<string>;
    drop(userId: string | undefined): Promise<void>;
}

export function createDraftKeys(storage: CacheStorage, now: () => number = Date.now, newKey: () => string = () => Crypto.randomUUID()): DraftKeys {
    const slot = (userId: string) => `${PREFIX}${userId}`;

    async function saved(userId: string): Promise<Saved | null> {
        try {
            const raw = await storage.get(slot(userId));
            if (raw === null) return null;
            const s = JSON.parse(raw) as Partial<Saved>;
            if (typeof s.signature !== 'string' || typeof s.key !== 'string' || typeof s.createdAt !== 'number') return null;
            const age = now() - s.createdAt;
            return age < 0 || age > MAX_AGE_MS ? null : { signature: s.signature, key: s.key, createdAt: s.createdAt };
        } catch {
            return null;
        }
    }

    return {
        async keyFor(userId, signature) {
            if (!userId) return newKey();
            const existing = await saved(userId);
            if (existing && existing.signature === signature) return existing.key;
            const key = newKey();
            // Saved before the send. If the disk refuses, the post still goes with a key held for this attempt only.
            await storage.set(slot(userId), JSON.stringify({ signature, key, createdAt: now() } satisfies Saved)).catch(() => undefined);
            return key;
        },
        async drop(userId) {
            if (userId) await storage.remove(slot(userId)).catch(() => undefined);
        },
    };
}
