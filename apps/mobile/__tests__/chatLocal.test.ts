import { act } from 'react';
import { createRoot } from 'test-renderer';
import { bindCacheUser, resetCacheUser, wipeCache, appCache } from '../src/lib/appCache';
import { createCache, createMemoryStorage, POLICIES, type CacheStorage } from '../src/lib/cache';
import { captureChat, readDraft, writeDraft, readStars, toggleStar, forgetThread, restoreDraft } from '../src/lib/chatLocal';
import { useChatLocal } from '../src/lib/useChatLocal';
const docs = createMemoryStorage();
beforeEach(() => { resetCacheUser(); (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true; });
async function setup(storage = createMemoryStorage()) {
    const cache = createCache(storage); await bindCacheUser('A', cache, storage, docs); return { cache, storage };
}
function deferred() { let resolve!: () => void; const promise = new Promise<void>(r => { resolve = r; }); return { promise, resolve }; }

test('bounds, invalid ids, whitespace removal, per-account reads and clear', async () => {
    const { cache } = await setup();
    await writeDraft('thread', 'x'.repeat(9000), cache);
    expect((await readDraft('thread', cache)).length).toBe(8000);
    await writeDraft('../bad', 'private', cache); expect(await readDraft('../bad', cache)).toBe('');
    await writeDraft('thread', '  ', cache); expect(await readDraft('thread', cache)).toBe('');
    for (let i = 0; i < 51; i++) await writeDraft(`t${i}`, 'text', cache);
    expect(await readDraft('t0', cache)).toBe(''); expect(await readDraft('t50', cache)).toBe('text');
    for (let i = 0; i < 201; i++) await toggleStar('thread', `m${i}`, cache);
    expect(await readStars('thread', cache)).toHaveLength(200);
    expect(await toggleStar('thread', '../bad', cache)).toBeNull();
    expect(await readStars('thread', cache, 'B')).toEqual([]);
    await cache.clear(); expect(await readDraft('t50', cache)).toBe(''); expect(await readStars('thread', cache)).toEqual([]);
});
test('no account never writes; malformed values read empty', async () => {
    const storage = createMemoryStorage(), cache = createCache(storage);
    await writeDraft('t', 'private', cache); await toggleStar('t', 'm', cache);
    expect(await storage.keys()).toEqual([]);
    await bindCacheUser('A', cache, storage, docs);
    await cache.write(POLICIES.chatDrafts, { drafts: [], deleted: [] }, 'A');
    await cache.write(POLICIES.chatStars, { t: 42 }, 'A');
    expect(await readDraft('t', cache)).toBe(''); expect(await readStars('t', cache)).toEqual([]);
});
test('overlapping mutations serialize; deletion invalidates an old flush and late give-back', async () => {
    const { cache } = await setup();
    await Promise.all([toggleStar('t', 'one', cache), toggleStar('t', 'two', cache)]);
    expect((await readStars('t', cache)).sort()).toEqual(['one', 'two']);
    const capture = captureChat('t', cache);
    await writeDraft('t', 'before', cache);
    await forgetThread('t', cache);
    expect(await writeDraft('t', 'old flush', cache, 'A', capture)).toBeNull();
    expect(await restoreDraft('t', 'sent', capture, cache)).toBeNull();
    expect(await writeDraft('t', 'new capture', cache)).toBeNull();
    expect(await readDraft('t', cache)).toBe(''); expect(await readStars('t', cache)).toEqual([]);
});
test.each(['wipe', 'switch', 'delete'] as const)('a deferred write cannot survive %s', async action => {
    const base = createMemoryStorage(), entered = deferred(), resume = deferred(); let pause = false;
    const storage: CacheStorage = { ...base, set: async (key, value) => {
        if (pause && key.includes('chat-drafts')) { pause = false; entered.resolve(); await resume.promise; }
        await base.set(key, value);
    } };
    const { cache } = await setup(storage); pause = true;
    const writing = writeDraft('t', 'private', cache); await entered.promise;
    let deleting: Promise<null> | undefined;
    if (action === 'wipe') await wipeCache(cache, docs);
    else if (action === 'switch') await bindCacheUser('B', cache, storage, docs);
    else deleting = forgetThread('t', cache);
    resume.resolve(); expect(await writing).toBeNull(); await deleting;
    expect(await readDraft('t', cache, 'A')).toBe(''); expect(await readDraft('t', cache, 'B')).toBe('');
    const raw = await cache.read<any>(POLICIES.chatDrafts, 'A');
    expect(raw?.value?.drafts?.t).toBeUndefined();
});
test.each(['wipe', 'switch'] as const)('a paused read is fenced before writing on %s', async action => {
    const base = createMemoryStorage(), entered = deferred(), resume = deferred(); let pause = false;
    const storage: CacheStorage = { ...base, get: async key => {
        const value = await base.get(key);
        if (pause && key.includes('chat-drafts')) { pause = false; entered.resolve(); await resume.promise; }
        return value;
    } };
    const { cache } = await setup(storage); pause = true;
    const writing = writeDraft('t', 'private', cache); await entered.promise;
    if (action === 'wipe') await wipeCache(cache, docs); else await bindCacheUser('B', cache, storage, docs);
    resume.resolve(); expect(await writing).toBeNull();
    expect(await cache.read(POLICIES.chatDrafts, 'A')).toBeNull();
});
test('restore merges without cutting newer text and refuses an account change', async () => {
    const { cache, storage } = await setup(); const capture = captureChat('t', cache);
    expect(await restoreDraft('t', 'sent', capture, cache)).toBe('sent');
    expect(await restoreDraft('t', 'sent', capture, cache)).toBe('sent');
    await writeDraft('t', 'newer', cache); expect(await restoreDraft('t', 'sent', capture, cache)).toBe('sent\n\nnewer');
    const newer = 'n'.repeat(7990); await writeDraft('t', newer, cache);
    expect(await restoreDraft('t', 'returned text', capture, cache)).toBe('returned\n\n' + newer);
    await writeDraft('t', 'n'.repeat(8000), cache); expect(await restoreDraft('t', 'sent', capture, cache)).toBe('n'.repeat(8000));
    await bindCacheUser('B', cache, storage, docs); expect(await restoreDraft('t', 'sent', capture, cache)).toBeNull();
});
test('hook restores once, debounces typing, flushes on unmount and drops sign-out timers', async () => {
    jest.useFakeTimers(); await bindCacheUser('A', appCache, createMemoryStorage(), docs);
    await writeDraft('t', 'saved'); let local!: ReturnType<typeof useChatLocal>;
    function Harness() { local = useChatLocal('t'); return null; }
    const root = createRoot();
    await act(async () => root.render(require('react').createElement(Harness)));
    expect(local.draft).toBe('saved');
    await act(async () => local.setDraft('typed'));
    expect(await readDraft('t')).toBe('saved');
    await act(async () => { jest.advanceTimersByTime(400); }); expect(await readDraft('t')).toBe('typed');
    await act(async () => local.setDraft('unmounted'));
    await act(async () => root.unmount()); expect(await readDraft('t')).toBe('unmounted');
    const next = createRoot(); await act(async () => next.render(require('react').createElement(Harness)));
    await act(async () => local.setDraft('must vanish'));
    await act(async () => { await wipeCache(appCache, docs); jest.advanceTimersByTime(500); });
    await act(async () => next.unmount());
    expect(await appCache.read(POLICIES.chatDrafts, 'A')).toBeNull(); jest.useRealTimers();
});

test('integer-like ids retain recency and prototype-like ids never expose inherited values', async () => {
    const { cache } = await setup();
    expect(await readDraft('__proto__', cache)).toBe(''); expect(await readStars('constructor', cache)).toEqual([]);
    for (let i = 100; i > 49; i--) await writeDraft(String(i), 'text', cache);
    expect(await readDraft('100', cache)).toBe(''); expect(await readDraft('50', cache)).toBe('text');
    await writeDraft('__proto__', 'safe', cache); expect(await readDraft('__proto__', cache)).toBe('safe');
    await toggleStar('constructor', '__proto__', cache); expect(await readStars('constructor', cache)).toEqual(['__proto__']);
});
