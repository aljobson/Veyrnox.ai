import { appCache, getCacheUser } from './appCache';
import { POLICIES, type Cache } from './cache';
import { draftIsEmpty, parseDraft, type CreateDraft } from './createOptions';

// ADR-0153: one unsent Create draft per account, so a closed app or a call does not lose a prompt. It sits under the
// cache prefix, so sign-out, account deletion and a change of user remove it. Never read for another account.
// Words and settings only: no file, no idempotency key, so restoring never re-sends or re-charges anything.

export async function loadDraft(modelId: string, cache: Cache = appCache, userId: string | undefined = getCacheUser()): Promise<CreateDraft | null> {
    const saved = await cache.read<unknown>(POLICIES.createDraft, userId).catch(() => null);
    const draft = saved ? parseDraft(saved.value, modelId) : null;
    return draft && !draftIsEmpty(draft) ? draft : null;
}

// An empty form clears the draft instead of saving one.
export async function saveDraft(draft: CreateDraft, cache: Cache = appCache, userId: string | undefined = getCacheUser()): Promise<void> {
    if (!userId) return;
    if (draftIsEmpty(draft)) return clearDraft(cache, userId);
    await cache.write(POLICIES.createDraft, draft, userId);
}

export async function clearDraft(cache: Cache = appCache, userId: string | undefined = getCacheUser()): Promise<void> {
    if (!userId) return;
    // The cache has no single-key delete; an empty value is read back as no draft.
    await cache.write(POLICIES.createDraft, null, userId);
}
