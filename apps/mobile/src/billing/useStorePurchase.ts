import { useCallback, useLayoutEffect, useSyncExternalStore } from 'react';
import { useAuth } from '../auth/AuthProvider';
import { useBilling } from './BillingProvider';
import { abortPreparing, acquirePurchaseAuxiliary, getPurchaseSnapshot, startExternalPurchase, startPurchase, subscribePurchase, syncPurchaseSession, type PurchaseRequest } from './storePurchaseStore';
import { purchaseActionPolicy, purchaseCatalogState, selectPurchaseViewState } from './purchaseViewState';

export function useStorePurchase() {
    const { api, beginSessionTask, generation } = useAuth();
    const billing = useBilling();
    const operation = useSyncExternalStore(subscribePurchase, getPurchaseSnapshot, getPurchaseSnapshot);
    useLayoutEffect(() => { syncPurchaseSession(beginSessionTask()); }, [beginSessionTask, generation]);
    const start = useCallback((request: PurchaseRequest) => startPurchase(request, { api, billing, beginSessionTask }), [api, billing, beginSessionTask]);
    const startExternal = useCallback((request: PurchaseRequest) => startExternalPurchase(request, { api, billing, beginSessionTask }), [api, billing, beginSessionTask]);
    const acquireAuxiliary = useCallback(() => acquirePurchaseAuxiliary(beginSessionTask()), [beginSessionTask]);
    const viewState = selectPurchaseViewState(operation, purchaseCatalogState(billing.status), billing.salesOpen);
    const actions = purchaseActionPolicy(viewState);
    return { operation, viewState, actions, start, startExternal, acquireAuxiliary, abortPreparing,
        busy: viewState.tag === 'preparing' || viewState.tag === 'store' || viewState.tag === 'confirming' };
}
