import type { PurchasesPackage } from 'react-native-purchases';
import type { SessionTask } from '../auth/sessionTask';
import type { PurchaseResult } from './BillingProvider';
import { getCacheUser, subscribeCacheUser } from '../lib/appCache';
import { publishBalance } from '../lib/balanceEvents';
import { generationPlanFor, waitForBalanceChange } from '../lib/billing';

// `credits` and `price` describe the pack bought, for the receipt; `price` is the store's own localized string.
export type PurchaseOutcome = { kind: 'credited'; balance: number; credits: number; price: string }
    | { kind: 'subscribed' | 'restored' | 'nothingToRestore' | 'cancelled' | 'pending' | 'error' | 'sales_closed' };
export type PurchasePhase = 'idle' | 'preparing' | 'store' | 'confirming' | 'done';
export interface PurchaseOperation {
    readonly opId: number;
    readonly owner: string | undefined;
    readonly phase: PurchasePhase;
    readonly kind: 'pack' | 'plan' | 'restore' | null;
    readonly productId: string | null;
    readonly outcome: PurchaseOutcome | null;
}
interface Dependencies {
    beginSessionTask(): SessionTask;
    api: { getBalance(): Promise<{ balance: number }> };
    billing: { canPurchase: boolean; canRestore: boolean; generationPurchaseReady: boolean;
        purchase(pkg: PurchasesPackage): Promise<PurchaseResult>; restore(): Promise<boolean> };
}
type GuardDependencies = Pick<Dependencies, 'beginSessionTask'> & {
    billing: Pick<Dependencies['billing'], 'canPurchase' | 'canRestore' | 'generationPurchaseReady'>;
};
export type PurchaseRequest = { kind: 'pack'; pkg: PurchasesPackage; expectedCredits: number }
    | { kind: 'plan'; pkg: PurchasesPackage } | { kind: 'restore' };
export interface ExternalPurchaseOperation {
    readonly opId: number;
    readonly kind: PurchaseRequest['kind'];
    /** Captures the pre-purchase balance for packs before RevenueCat is allowed to open StoreKit. */
    readonly ready: Promise<boolean>;
    markStore(): boolean;
    complete(productId?: string, restored?: boolean): Promise<PurchaseOutcome | null>;
    finish(outcome: { kind: 'cancelled' | 'pending' | 'error' | 'sales_closed' }): PurchaseOutcome | null;
    abort(): void;
}
let serial = 0;
let current: PurchaseOperation = empty();
let session: SessionTask | null = null;
let cancellation: AbortController | null = null;
let auxiliary: symbol | null = null;
const listeners = new Set<() => void>();
function empty(): PurchaseOperation {
    return { opId: ++serial, owner: getCacheUser(), phase: 'idle', kind: null, productId: null, outcome: null };
}
function emit() { listeners.forEach(listener => listener()); }
function reset() { cancellation?.abort(); cancellation = null; current = empty(); session = null; auxiliary = null; emit(); }
subscribeCacheUser(reset);
export function syncPurchaseSession(task: SessionTask) {
    if (!task.current()) return;
    if (current.owner !== getCacheUser() || (session && (!session.current() || session.gen !== task.gen))) reset();
    session = task;
}
export const subscribePurchase = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
export const getPurchaseSnapshot = () => current;
export const purchaseBusy = () => current.phase !== 'idle' && current.phase !== 'done';
export function abortPreparing(opId: number) {
    if (current.opId === opId && current.phase === 'preparing') reset();
}
export function settleExternalUnmount(operation: ExternalPurchaseOperation) {
    if (current.opId !== operation.opId) return;
    if (current.phase === 'store') operation.finish({ kind: 'pending' });
    else if (current.phase === 'preparing') operation.abort();
    // Confirmation is server reconciliation and safely continues without its originating screen.
}
// Cancellation / access retries keep their own UI state, but must also exclude purchases on another screen.
export function acquirePurchaseAuxiliary(task: SessionTask): (() => void) | null {
    syncPurchaseSession(task);
    if (!task.current() || purchaseBusy() || auxiliary) return null;
    const token = Symbol(); auxiliary = token;
    return () => { if (auxiliary === token) auxiliary = null; };
}

interface OperationCore {
    readonly opId: number;
    readonly owner: string;
    readonly controller: AbortController;
    live(): boolean;
    active(): boolean;
    phase(value: PurchasePhase): boolean;
    finish(outcome: PurchaseOutcome): PurchaseOutcome | null;
    confirmPack(request: Extract<PurchaseRequest, { kind: 'pack' }>, before: number, deps: Pick<Dependencies, 'api'>): Promise<PurchaseOutcome | null>;
    finishRestore(restored: boolean, deps: Pick<Dependencies, 'api'>): Promise<PurchaseOutcome | null>;
}

function beginOperation(request: PurchaseRequest, deps: GuardDependencies): OperationCore | 'busy' | 'unavailable' {
    const task = deps.beginSessionTask();
    syncPurchaseSession(task);
    if (purchaseBusy() || auxiliary) return 'busy';
    const owner = getCacheUser();
    const generationPlan = request.kind === 'plan' && generationPlanFor(request.pkg.product.identifier) !== null;
    if (!owner || task.user !== owner || !task.current() || (request.kind === 'restore' ? !deps.billing.canRestore
        : !deps.billing.canPurchase || (generationPlan && !deps.billing.generationPurchaseReady))) return 'unavailable';
    const opId = ++serial;
    const controller = new AbortController();
    cancellation = controller;
    current = { opId, owner, phase: 'preparing', kind: request.kind,
        productId: request.kind === 'restore' ? null : request.pkg.product.identifier, outcome: null };
    emit(); // Synchronous lock, before even the baseline read.
    const live = () => current.opId === opId && task.current() && owner === getCacheUser();
    const active = () => live() && current.phase !== 'done';
    const phase = (value: PurchasePhase) => {
        if (!active()) return false;
        current = { ...current, phase: value }; emit(); return true;
    };
    const finish = (outcome: PurchaseOutcome): PurchaseOutcome | null => {
        if (!live()) return null;
        if (current.phase === 'done') return current.outcome;
        controller.abort();
        current = { ...current, phase: 'done', outcome }; emit(); return outcome;
    };
    const core: OperationCore = {
        opId, owner, controller, live, active, phase, finish,
        confirmPack: async (pack, before, balanceDeps) => {
            if (!phase('confirming')) return null;
            const resultBalance = await waitForBalanceChange(async () => {
                if (!active()) { controller.abort(); throw new Error('account_changed'); }
                const next = await balanceDeps.api.getBalance();
                if (!active()) { controller.abort(); throw new Error('account_changed'); }
                return next.balance;
            }, before, { minimumIncrease: pack.expectedCredits, deadlineMs: Date.now() + 40_000, signal: controller.signal });
            if (!active()) return current.opId === opId ? current.outcome : null;
            if (resultBalance.changed) publishBalance(owner, resultBalance.balance);
            return finish(resultBalance.changed
                ? { kind: 'credited', balance: resultBalance.balance, credits: pack.expectedCredits, price: pack.pkg.product.priceString }
                : { kind: 'pending' });
        },
        finishRestore: async (restored, balanceDeps) => {
            if (!phase('confirming')) return null;
            try { const next = await balanceDeps.api.getBalance(); if (active()) publishBalance(owner, next.balance); } catch { /* Store restore succeeded while balance refresh was offline. */ }
            return finish({ kind: restored ? 'restored' : 'nothingToRestore' });
        },
    };
    return core;
}

export function startPurchase(request: PurchaseRequest, deps: Dependencies): { opId: number; completion: Promise<void> } | 'busy' | 'unavailable' {
    const core = beginOperation(request, deps);
    if (typeof core === 'string') return core;
    const completion = (async () => {
        let purchased = false;
        try {
            const before = request.kind === 'pack' ? (await deps.api.getBalance()).balance : 0;
            if (!core.active()) return;
            // This phase includes BillingProvider's SDK preflight as well as the native sheet.
            core.phase('store');
            if (request.kind === 'restore') {
                const restored = await deps.billing.restore();
                if (!core.active()) return;
                await core.finishRestore(restored, deps);
                return;
            }
            const result = await deps.billing.purchase(request.pkg);
            if (!core.active()) return;
            if (result === 'cancelled') { core.finish({ kind: 'cancelled' }); return; }
            purchased = true;
            if (result === 'pending') { core.finish({ kind: 'pending' }); return; }
            if (request.kind === 'plan') { core.finish({ kind: 'subscribed' }); return; }
            await core.confirmPack(request, before, deps);
        } catch (error) {
            core.finish({ kind: purchased ? 'pending'
                : error instanceof Error && error.message === 'sales_closed' ? 'sales_closed' : 'error' });
        }
        // No unconditional finally: an old operation must never release a replacement's lock.
    })();
    return { opId: core.opId, completion };
}

export const EXTERNAL_PREPARE_TIMEOUT_MS = 10_000;
const normalizedProductId = (value: string) => value.split(':', 1)[0];

async function within<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('timeout')), timeoutMs); });
    try { return await Promise.race([promise, timeout]); }
    finally { clearTimeout(timer); }
}

/**
 * Joins a purchase executed by RevenueCat Paywalls to the same operation state used by the
 * app-owned Credits and contextual paywalls. RevenueCat still owns StoreKit; this controller
 * owns locking, identity fencing and server-side credit fulfilment confirmation.
 */
export function startExternalPurchase(request: PurchaseRequest, deps: Pick<Dependencies, 'api'> & GuardDependencies): ExternalPurchaseOperation | 'busy' | 'unavailable' {
    const core = beginOperation(request, deps);
    if (typeof core === 'string') return core;
    let before = 0;
    let prepared = request.kind !== 'pack';
    const finish = (outcome: PurchaseOutcome) => core.finish(outcome);
    const ready = (async () => {
        if (request.kind !== 'pack') return core.live();
        try {
            before = (await within(deps.api.getBalance(), EXTERNAL_PREPARE_TIMEOUT_MS)).balance;
            prepared = core.active();
            return prepared;
        } catch {
            finish({ kind: 'error' });
            return false;
        }
    })();
    return {
        opId: core.opId,
        kind: request.kind,
        ready,
        markStore: () => {
            if (!prepared || !core.phase('store')) return false;
            return true;
        },
        complete: async (productId?: string, restored?: boolean) => {
            if (!core.live() || !prepared) return null;
            if (current.phase === 'done') return current.outcome;
            if (current.phase !== 'store') return null;
            if (request.kind !== 'restore' && (!productId || normalizedProductId(productId) !== normalizedProductId(request.pkg.product.identifier))) {
                return finish({ kind: 'pending' });
            }
            if (request.kind === 'restore') {
                return core.finishRestore(restored === true, deps);
            }
            if (request.kind === 'plan') return finish({ kind: 'subscribed' });
            return core.confirmPack(request, before, deps);
        },
        finish,
        abort: () => abortPreparing(core.opId),
    };
}
