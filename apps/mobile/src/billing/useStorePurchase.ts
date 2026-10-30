import { useCallback, useLayoutEffect, useSyncExternalStore } from 'react';
import { useAuth } from '../auth/AuthProvider';
import { useBilling } from './BillingProvider';
import { abortPreparing, acquirePurchaseAuxiliary, getPurchaseSnapshot, startPurchase, subscribePurchase, syncPurchaseSession, type PurchaseRequest } from './storePurchaseStore';

export function useStorePurchase() {
    const { api, beginSessionTask, generation } = useAuth();
    const billing = useBilling();
    const operation = useSyncExternalStore(subscribePurchase, getPurchaseSnapshot, getPurchaseSnapshot);
    useLayoutEffect(() => { syncPurchaseSession(beginSessionTask()); }, [beginSessionTask, generation]);
    const start = useCallback((request: PurchaseRequest) => startPurchase(request, { api, billing, beginSessionTask }), [api, billing, beginSessionTask]);
    const acquireAuxiliary = useCallback(() => acquirePurchaseAuxiliary(beginSessionTask()), [beginSessionTask]);
    return { operation, start, acquireAuxiliary, abortPreparing,
        busy: operation.phase !== 'idle' && operation.phase !== 'done' };
}
