import type { ApiClient } from './api';
import { appCache, getCacheUser } from './appCache';
import { POLICIES, type Cache } from './cache';
import { draftIsEmpty, parseDraft, type CreateDraft } from './createOptions';
import { clearRemoteDraft, fetchLibrarySync, fromSharedDraft, pushDraft, toSharedDraft } from './librarySync';

// ADR-0153: one unsent Create draft per account, so a closed app or a call does not lose a prompt. It sits under the
// cache prefix, so sign-out, account deletion and a change of user remove it. Never read for another account.
// Words and settings only: no file, no idempotency key, so restoring never re-sends or re-charges anything.
//
// ADR-0340: with library sync on, the account holds the same words, so a draft started on the web is here (and the
// other way round). The account copy is used only when the screen passes `api`; it wins when it is newer than this
// phone's copy. Once the account has refused or failed to answer, nothing more is sent until the next load.

type Requester = Pick<ApiClient, 'request'>;
let remote: { readonly userId: string; readonly ok: boolean } | null = null;
const remoteFor = (userId: string | undefined): boolean => !!userId && remote?.userId === userId && remote.ok;

export async function loadDraft(modelId: string, cache: Cache = appCache, userId: string | undefined = getCacheUser(), api?: Requester): Promise<CreateDraft | null> {
    const saved = await cache.read<unknown>(POLICIES.createDraft, userId).catch(() => null);
    const parsed = saved ? parseDraft(saved.value, modelId) : null;
    const draft = parsed && !draftIsEmpty(parsed) ? parsed : null;
    if (!api || !userId) return draft;
    const account = await fetchLibrarySync(api);
    remote = { userId, ok: account.kind === 'ok' };
    if (account.kind !== 'ok') return draft;
    const theirs = fromSharedDraft(account.draft, modelId);
    if (!theirs || draftIsEmpty(theirs)) return draft;
    return !draft || (account.draftUpdatedAt ?? 0) > (saved?.meta.savedAt ?? 0) ? theirs : draft;
}

// An empty form clears the draft instead of saving one.
export async function saveDraft(draft: CreateDraft, cache: Cache = appCache, userId: string | undefined = getCacheUser(), api?: Requester): Promise<void> {
    if (!userId) return;
    if (draftIsEmpty(draft)) return clearDraft(cache, userId, api);
    await cache.write(POLICIES.createDraft, draft, userId);
    const shared = toSharedDraft(draft);
    if (api && shared && remoteFor(userId)) await pushDraft(api, shared);
}

export async function clearDraft(cache: Cache = appCache, userId: string | undefined = getCacheUser(), api?: Requester): Promise<void> {
    if (!userId) return;
    // The cache has no single-key delete; an empty value is read back as no draft.
    await cache.write(POLICIES.createDraft, null, userId);
    if (api && remoteFor(userId)) await clearRemoteDraft(api);
}
