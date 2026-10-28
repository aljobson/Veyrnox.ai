import { appCache, getCacheUser, subscribeCacheUser } from './appCache';
import { POLICIES, type Cache, type CachePolicy } from './cache';

const ID = /^[A-Za-z0-9_-]{1,64}$/;
let epoch = 0;
subscribeCacheUser(() => { epoch++; });
const queues = new WeakMap<Cache, Promise<unknown>>();
const tokens = new WeakMap<Cache, Map<string, number>>();
export interface ChatCapture { readonly owner: string | undefined; readonly epoch: number; readonly threadId: string; readonly token: number }
function tokenFor(cache: Cache, owner: string | undefined, id: string) { return tokens.get(cache)?.get(`${owner}:${id}`) ?? 0; }
export function captureChat(threadId: string, cache = appCache, userId = getCacheUser()): ChatCapture {
    return { owner: userId, epoch, threadId, token: tokenFor(cache, userId, threadId) };
}
export function currentCapture(c: ChatCapture, cache = appCache): boolean {
    return !!c.owner && c.owner === getCacheUser() && c.epoch === epoch && c.token === tokenFor(cache, c.owner, c.threadId);
}
function serialized<T>(cache: Cache, fn: () => Promise<T>): Promise<T> {
    const run = (queues.get(cache) ?? Promise.resolve()).catch(() => undefined).then(fn);
    queues.set(cache, run); return run;
}
const own = <T>(map: Record<string, T>, id: string): T | undefined => Object.prototype.hasOwnProperty.call(map, id) ? map[id] : undefined;
type Drafts = { drafts: Record<string, string>; deleted: string[]; order: string[] };
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
function cleanDrafts(v: unknown): Drafts {
    if (!object(v) || !object(v.drafts) || !Array.isArray(v.deleted)) return { drafts: {}, deleted: [], order: [] };
    const deleted = v.deleted.filter((id): id is string => typeof id === 'string' && ID.test(id)).slice(0, 200);
    const entries = Object.entries(v.drafts).filter(([id, text]) => ID.test(id) && typeof text === 'string' && text.trim() && !deleted.includes(id));
    const valid = new Map(entries);
    // JSON objects enumerate integer-like ids numerically, so keep recency explicitly.
    const order = [...new Set([...(Array.isArray(v.order) ? v.order.filter((id): id is string => typeof id === 'string') : []), ...valid.keys()])].filter(id => valid.has(id)).slice(0, 50);
    return { drafts: Object.fromEntries(order.map(id => [id, (valid.get(id) as string).slice(0, 8000)])), deleted, order };
}
function cleanStars(v: unknown): Record<string, string[]> {
    if (!object(v)) return {};
    return Object.fromEntries(Object.entries(v).filter(([id, ids]) => ID.test(id) && Array.isArray(ids)).slice(0, 200)
        .map(([id, ids]) => [id, [...new Set((ids as unknown[]).filter((x): x is string => typeof x === 'string' && ID.test(x)))].slice(0, 200)]));
}
async function readValue(cache: Cache, policy: CachePolicy, owner: string | undefined) {
    return owner ? (await cache.read<unknown>(policy, owner))?.value : null;
}
async function writeFenced(cache: Cache, policy: CachePolicy, value: unknown, c: ChatCapture): Promise<boolean> {
    if (!currentCapture(c, cache)) return false;
    await cache.write(policy, value, c.owner);
    if (!currentCapture(c, cache)) { await cache.write(policy, null, c.owner); return false; }
    return true;
}
export function readDraft(threadId: string, cache = appCache, userId = getCacheUser()): Promise<string> {
    const c = captureChat(threadId, cache, userId);
    return serialized(cache, async () => {
        if (!ID.test(threadId) || !currentCapture(c, cache)) return '';
        const r = cleanDrafts(await readValue(cache, POLICIES.chatDrafts, userId));
        return currentCapture(c, cache) ? own(r.drafts, threadId) ?? '' : '';
    });
}
export function readStars(threadId: string, cache = appCache, userId = getCacheUser()): Promise<string[]> {
    const c = captureChat(threadId, cache, userId);
    return serialized(cache, async () => {
        if (!ID.test(threadId) || !currentCapture(c, cache)) return [];
        const r = cleanStars(await readValue(cache, POLICIES.chatStars, userId));
        return currentCapture(c, cache) ? own(r, threadId) ?? [] : [];
    });
}
function draftMutation(threadId: string, text: string, restore: boolean, cache: Cache, c: ChatCapture): Promise<string | null> {
    return serialized(cache, async () => {
        if (!ID.test(threadId) || c.threadId !== threadId || !currentCapture(c, cache)) return null;
        const r = cleanDrafts(await readValue(cache, POLICIES.chatDrafts, c.owner));
        if (!currentCapture(c, cache) || r.deleted.includes(threadId)) return null;
        let next = text.slice(0, 8000);
        if (restore) {
            const was = own(r.drafts, threadId) ?? '';
            if (was === next || (was && 8000 - was.length - 2 <= 0)) return was;
            if (was) next = `${next.slice(0, 8000 - was.length - 2)}\n\n${was}`;
        }
        delete r.drafts[threadId];
        r.order = [...next.trim() ? [threadId] : [], ...r.order.filter(id => id !== threadId)].slice(0, 50);
        r.drafts = Object.fromEntries(r.order.map(id => [id, id === threadId ? next : r.drafts[id]]));
        return await writeFenced(cache, POLICIES.chatDrafts, r, c) ? next : null;
    });
}
export function writeDraft(threadId: string, text: string, cache = appCache, userId = getCacheUser(), capture = captureChat(threadId, cache, userId)) {
    return draftMutation(threadId, text, false, cache, capture);
}
export function restoreDraft(threadId: string, text: string, capture: ChatCapture, cache = appCache) {
    return draftMutation(threadId, text, true, cache, capture);
}
export function toggleStar(threadId: string, messageId: string, cache = appCache, userId = getCacheUser()): Promise<string[] | null> {
    const c = captureChat(threadId, cache, userId);
    return serialized(cache, async () => {
        if (!ID.test(threadId) || !ID.test(messageId) || !currentCapture(c, cache)) return null;
        const drafts = cleanDrafts(await readValue(cache, POLICIES.chatDrafts, userId));
        if (!currentCapture(c, cache) || drafts.deleted.includes(threadId)) return null;
        const r = cleanStars(await readValue(cache, POLICIES.chatStars, userId));
        if (!currentCapture(c, cache)) return null;
        const ids = own(r, threadId) ?? [];
        const next = ids.includes(messageId) ? ids.filter(id => id !== messageId) : [messageId, ...ids].slice(0, 200);
        delete r[threadId];
        const value = Object.fromEntries([[threadId, next], ...Object.entries(r)].slice(0, 200));
        return await writeFenced(cache, POLICIES.chatStars, value, c) ? next : null;
    });
}
export function forgetThread(threadId: string, cache = appCache, userId = getCacheUser()): Promise<null> {
    if (!ID.test(threadId) || !userId || userId !== getCacheUser()) return Promise.resolve(null);
    const map = tokens.get(cache) ?? new Map<string, number>();
    map.set(`${userId}:${threadId}`, tokenFor(cache, userId, threadId) + 1); tokens.set(cache, map);
    const c = captureChat(threadId, cache, userId);
    return serialized(cache, async () => {
        if (!currentCapture(c, cache)) return null;
        const drafts = cleanDrafts(await readValue(cache, POLICIES.chatDrafts, userId));
        if (!currentCapture(c, cache)) return null;
        delete drafts.drafts[threadId];
        drafts.order = drafts.order.filter(id => id !== threadId);
        drafts.deleted = [threadId, ...drafts.deleted.filter(id => id !== threadId)].slice(0, 200);
        if (!await writeFenced(cache, POLICIES.chatDrafts, drafts, c)) return null;
        const stars = cleanStars(await readValue(cache, POLICIES.chatStars, userId));
        if (!currentCapture(c, cache)) return null;
        delete stars[threadId];
        await writeFenced(cache, POLICIES.chatStars, stars, c);
        return null;
    });
}
