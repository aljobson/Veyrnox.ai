import type { PurchaseOperation, PurchaseOutcome } from './storePurchaseStore';

export const PURCHASE_VIEW_TAGS = [
    'idle', 'loading', 'ready', 'preparing', 'store', 'confirming', 'credited', 'subscribed',
    'restored', 'nothing-to-restore', 'cancelled', 'pending', 'error', 'sales-closed',
] as const;

export type PurchaseViewTag = (typeof PURCHASE_VIEW_TAGS)[number];
export interface PurchaseViewState {
    readonly tag: PurchaseViewTag;
    readonly operation: PurchaseOperation;
    readonly outcome: PurchaseOutcome | null;
}

export interface PurchaseActionPolicy {
    readonly buy: boolean;
    readonly restore: boolean;
    readonly manage: boolean;
    readonly retry: boolean;
    readonly close: boolean;
}

type CatalogState = 'idle' | 'loading' | 'ready' | 'error';

const OUTCOME_TAG: Record<PurchaseOutcome['kind'], PurchaseViewTag> = {
    credited: 'credited',
    subscribed: 'subscribed',
    restored: 'restored',
    nothingToRestore: 'nothing-to-restore',
    cancelled: 'cancelled',
    pending: 'pending',
    error: 'error',
    sales_closed: 'sales-closed',
};

export function selectPurchaseViewState(operation: PurchaseOperation, catalog: CatalogState, salesOpen: boolean): PurchaseViewState {
    let tag: PurchaseViewTag;
    if (operation.phase === 'preparing' || operation.phase === 'store' || operation.phase === 'confirming') tag = operation.phase;
    else if (operation.phase === 'done' && operation.outcome) tag = OUTCOME_TAG[operation.outcome.kind];
    else if (catalog === 'loading') tag = 'loading';
    else if (catalog === 'ready') tag = salesOpen ? 'ready' : 'sales-closed';
    else tag = catalog === 'error' ? 'error' : 'idle';
    return { tag, operation, outcome: operation.outcome };
}

const BUYABLE = new Set<PurchaseViewTag>(['ready', 'credited', 'subscribed', 'restored', 'nothing-to-restore', 'cancelled', 'error']);
const RESTORABLE = new Set<PurchaseViewTag>(['ready', 'credited', 'subscribed', 'restored', 'nothing-to-restore', 'cancelled', 'pending', 'error', 'sales-closed']);
export function purchaseActionPolicy(state: PurchaseViewState): PurchaseActionPolicy {
    return {
        buy: BUYABLE.has(state.tag),
        restore: RESTORABLE.has(state.tag),
        manage: state.tag !== 'store',
        retry: state.tag === 'error' || state.tag === 'sales-closed',
        close: state.tag !== 'store',
    };
}

export function purchaseCatalogState(status: 'off' | 'loading' | 'ready' | 'unavailable'): CatalogState {
    if (status === 'loading') return 'loading';
    if (status === 'ready') return 'ready';
    return status === 'unavailable' ? 'error' : 'idle';
}
