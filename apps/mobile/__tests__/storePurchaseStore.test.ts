import { startPurchase, getPurchaseSnapshot, abortPreparing, purchaseBusy, syncPurchaseSession, acquirePurchaseAuxiliary } from '../src/billing/storePurchaseStore';
import { bindCacheUser, getCacheUser, wipeCache } from '../src/lib/appCache';
import { subscribeBalance } from '../src/lib/balanceEvents';
import { waitForBalanceChange } from '../src/lib/billing';
function deferred<T>() {
    let resolve!: (value: T) => void, reject!: (error: Error) => void;
    const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
    return { promise, resolve, reject };
}
const pkg = { identifier: 'pack', product: { identifier: 'ai.veyrnox.credits.100', priceString: '£4.99' } } as any;
let generation = 0;
const beginSessionTask = () => {
    const gen = generation, user = getCacheUser();
    return { gen, user: user ?? null, current: () => gen === generation && user === getCacheUser(), tokens: {} as any };
};
const api = { getBalance: jest.fn() };
const billing = { canPurchase: true, canRestore: true, generationPurchaseReady: true, purchase: jest.fn(), restore: jest.fn() };
const deps = { api, billing, beginSessionTask };
const pack = { kind: 'pack' as const, pkg, expectedCredits: 100 };
function start() { const op = startPurchase(pack, deps); if (typeof op === 'string') throw Error(op); return op; }
const flush = async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); };
beforeEach(async () => {
    jest.useFakeTimers(); await wipeCache(); await bindCacheUser('buyer'); generation++;
    api.getBalance.mockReset().mockResolvedValue({ balance: 0 }); billing.purchase.mockReset().mockResolvedValue('purchased');
    billing.restore.mockReset().mockResolvedValue(true); billing.canPurchase = true;
});
afterEach(async () => { await wipeCache(); jest.clearAllTimers(); jest.useRealTimers(); });
test('locks synchronously during a slow baseline and aborts before the native call', async () => {
    const baseline = deferred<{ balance: number }>(); api.getBalance.mockReturnValue(baseline.promise);
    const op = start(); expect(getPurchaseSnapshot().phase).toBe('preparing');
    expect(startPurchase(pack, deps)).toBe('busy'); expect(api.getBalance).toHaveBeenCalledTimes(1);
    abortPreparing(op.opId);
    expect(getPurchaseSnapshot()).toMatchObject({ phase: 'idle', outcome: null });
    expect(getPurchaseSnapshot().opId).not.toBe(op.opId);
    baseline.resolve({ balance: 0 }); await op.completion;
    expect(billing.purchase).not.toHaveBeenCalled(); expect(getPurchaseSnapshot().outcome).toBeNull();
});
test('confirmation survives dismissal, keeps the shared lock and publishes only the minimum increase', async () => {
    const published = jest.fn(), unsubscribe = subscribeBalance(published);
    api.getBalance.mockResolvedValueOnce({ balance: 5 }).mockResolvedValueOnce({ balance: 104 }).mockResolvedValue({ balance: 105 });
    const op = start(); await flush();
    expect(getPurchaseSnapshot().phase).toBe('confirming'); abortPreparing(op.opId);
    expect(startPurchase(pack, deps)).toBe('busy'); expect(published).not.toHaveBeenCalled();
    await jest.advanceTimersByTimeAsync(2000); await op.completion;
    expect(getPurchaseSnapshot().outcome).toEqual({ kind: 'credited', balance: 105, credits: 100, price: '£4.99' });
    expect(published).toHaveBeenCalledWith('buyer', 105); expect(purchaseBusy()).toBe(false); unsubscribe();
});
test.each(['owner', 'generation'])('late native completion after %s change cannot touch a replacement', async change => {
    const published = jest.fn(), unsubscribe = subscribeBalance(published);
    const oldNative = deferred<string>(), newBaseline = deferred<{ balance: number }>();
    billing.purchase.mockReturnValueOnce(oldNative.promise);
    const old = start(); await flush(); expect(getPurchaseSnapshot().phase).toBe('store');
    if (change === 'owner') await bindCacheUser('other'); else generation++;
    syncPurchaseSession(beginSessionTask());
    api.getBalance.mockReturnValueOnce(newBaseline.promise);
    const replacement = start(); const snapshot = getPurchaseSnapshot();
    oldNative.resolve('purchased'); await old.completion;
    expect(getPurchaseSnapshot()).toBe(snapshot); expect(purchaseBusy()).toBe(true);
    expect(published).not.toHaveBeenCalled();
    abortPreparing(replacement.opId); newBaseline.resolve({ balance: 0 }); await replacement.completion; unsubscribe();
});
test('owner change during confirmation publishes nothing', async () => {
    const read = deferred<{ balance: number }>(), published = jest.fn(), unsubscribe = subscribeBalance(published);
    api.getBalance.mockResolvedValueOnce({ balance: 0 }).mockReturnValue(read.promise);
    const op = start(); await flush(); expect(getPurchaseSnapshot().phase).toBe('confirming');
    await bindCacheUser('other'); await op.completion;
    read.resolve({ balance: 100 }); await flush();
    expect(published).not.toHaveBeenCalled(); expect(getPurchaseSnapshot().phase).toBe('idle'); unsubscribe();
});
test.each([
    ['same-account re-login', 'balance'], ['same-account re-login', 'failure'],
    ['sign-out', 'balance'], ['sign-out', 'failure'],
])('%s during confirming resets identity and ignores a late %s', async (change, completion) => {
    const read = deferred<{ balance: number }>(), published = jest.fn(), unsubscribe = subscribeBalance(published);
    api.getBalance.mockResolvedValueOnce({ balance: 0 }).mockReturnValue(read.promise);
    const op = start(); await flush(); expect(getPurchaseSnapshot().phase).toBe('confirming');
    if (change === 'sign-out') await wipeCache();
    else { generation++; syncPurchaseSession(beginSessionTask()); }
    const reset = getPurchaseSnapshot();
    expect(reset).toMatchObject({ phase: 'idle', kind: null, productId: null, outcome: null }); expect(reset.opId).not.toBe(op.opId);
    expect(reset.owner).toBe(change === 'sign-out' ? undefined : 'buyer'); expect(purchaseBusy()).toBe(false);
    // Completes before the old read and without advancing the 40-second deadline.
    await op.completion;
    if (completion === 'balance') read.resolve({ balance: 100 }); else read.reject(new Error('offline'));
    await flush();
    expect(getPurchaseSnapshot()).toBe(reset); expect(published).not.toHaveBeenCalled();
    expect(api.getBalance).toHaveBeenCalledTimes(2); unsubscribe();
});
test.each(['owner', 'generation', 'sign-out'])('%s invalidation interrupts the confirmation retry interval immediately', async change => {
    const op = start(); await flush(); expect(getPurchaseSnapshot().phase).toBe('confirming');
    expect(api.getBalance).toHaveBeenCalledTimes(2);
    if (change === 'owner') await bindCacheUser('other');
    else if (change === 'sign-out') await wipeCache();
    else { generation++; syncPurchaseSession(beginSessionTask()); }
    await op.completion;
    await jest.advanceTimersByTimeAsync(40000);
    expect(api.getBalance).toHaveBeenCalledTimes(2);
});
test('a real elapsed deadline includes a stalled read and rejects a late balance', async () => {
    const read = deferred<number>();
    const pending = waitForBalanceChange(() => read.promise, 0, { minimumIncrease: 100, deadlineMs: Date.now() + 40000 });
    await jest.advanceTimersByTimeAsync(40000); expect(await pending).toEqual({ changed: false, balance: 0 });
    read.resolve(100); await flush();
});
test('auxiliary cancellation and retry work excludes purchases in both directions', async () => {
    const release = acquirePurchaseAuxiliary(beginSessionTask()); expect(release).not.toBeNull();
    expect(startPurchase(pack, deps)).toBe('busy'); release!();
    const baseline = deferred<{ balance: number }>(); api.getBalance.mockReturnValueOnce(baseline.promise);
    const op = start(); expect(acquirePurchaseAuxiliary(beginSessionTask())).toBeNull();
    abortPreparing(op.opId); baseline.resolve({ balance: 0 }); await op.completion;
});
test('restore remains available with sales closed', async () => {
    billing.canPurchase = false; expect(startPurchase(pack, deps)).toBe('unavailable');
    const restored = startPurchase({ kind: 'restore' }, deps); if (typeof restored === 'string') throw Error(restored);
    await restored.completion; expect(billing.restore).toHaveBeenCalledTimes(1); expect(getPurchaseSnapshot().outcome?.kind).toBe('restored');
});
