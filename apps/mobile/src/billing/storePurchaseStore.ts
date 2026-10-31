import type { PurchasesPackage } from 'react-native-purchases';
import type { SessionTask } from '../auth/sessionTask';
import type { PurchaseResult } from './BillingProvider';
import { getCacheUser, subscribeCacheUser } from '../lib/appCache';
import { publishBalance } from '../lib/balanceEvents';
import { waitForBalanceChange } from '../lib/billing';

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
export type PurchaseRequest = { kind: 'pack'; pkg: PurchasesPackage; expectedCredits: number }
    | { kind: 'plan'; pkg: PurchasesPackage } | { kind: 'restore' };
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
// Cancellation / access retries keep their own UI state, but must also exclude purchases on another screen.
export function acquirePurchaseAuxiliary(task: SessionTask): (() => void) | null {
    syncPurchaseSession(task);
    if (!task.current() || purchaseBusy() || auxiliary) return null;
    const token = Symbol(); auxiliary = token;
    return () => { if (auxiliary === token) auxiliary = null; };
}
export function startPurchase(request: PurchaseRequest, deps: Dependencies): { opId: number; completion: Promise<void> } | 'busy' | 'unavailable' {
    const task = deps.beginSessionTask();
    syncPurchaseSession(task);
    if (purchaseBusy() || auxiliary) return 'busy';
    const owner = getCacheUser();
    if (!owner || task.user !== owner || !task.current() || (request.kind === 'restore' ? !deps.billing.canRestore
        : !deps.billing.canPurchase || (request.kind === 'plan' && !deps.billing.generationPurchaseReady))) return 'unavailable';
    const opId = ++serial;
    const controller = new AbortController();
    cancellation = controller;
    current = { opId, owner, phase: 'preparing', kind: request.kind,
        productId: request.kind === 'restore' ? null : request.pkg.product.identifier, outcome: null };
    emit(); // Synchronous lock, before even the baseline read.
    const live = () => current.opId === opId && task.current() && owner === getCacheUser();
    const phase = (value: PurchasePhase) => { if (live()) { current = { ...current, phase: value }; emit(); } };
    const finish = (outcome: PurchaseOutcome) => { if (live()) { current = { ...current, phase: 'done', outcome }; emit(); } };
    const completion = (async () => {
        let purchased = false;
        try {
            const before = request.kind === 'pack' ? (await deps.api.getBalance()).balance : 0;
            if (!live()) return;
            // This phase includes BillingProvider's SDK preflight as well as the native sheet.
            phase('store');
            if (request.kind === 'restore') {
                const restored = await deps.billing.restore();
                if (!live()) return;
                phase('confirming');
                try { const next = await deps.api.getBalance(); if (live()) publishBalance(owner, next.balance); } catch { /* Restore succeeded even if balance is offline. */ }
                finish({ kind: restored ? 'restored' : 'nothingToRestore' });
                return;
            }
            const result = await deps.billing.purchase(request.pkg);
            if (!live()) return;
            if (result === 'cancelled') { finish({ kind: 'cancelled' }); return; }
            purchased = true;
            if (result === 'pending') { finish({ kind: 'pending' }); return; }
            if (request.kind === 'plan') { finish({ kind: 'subscribed' }); return; }
            phase('confirming');
            const expectedCredits = request.expectedCredits;
            const resultBalance = await waitForBalanceChange(async () => {
                if (!live()) { controller.abort(); throw new Error('account_changed'); }
                const next = await deps.api.getBalance();
                if (!live()) { controller.abort(); throw new Error('account_changed'); }
                return next.balance;
            }, before, { minimumIncrease: expectedCredits, deadlineMs: Date.now() + 40_000, signal: controller.signal });
            if (!live()) return;
            if (resultBalance.changed) publishBalance(owner, resultBalance.balance);
            finish(resultBalance.changed
                ? { kind: 'credited', balance: resultBalance.balance, credits: expectedCredits, price: request.pkg.product.priceString }
                : { kind: 'pending' });
        } catch (error) {
            finish({ kind: purchased ? 'pending'
                : error instanceof Error && error.message === 'sales_closed' ? 'sales_closed' : 'error' });
        }
        // No unconditional finally: an old operation must never release a replacement's lock.
    })();
    return { opId, completion };
}
