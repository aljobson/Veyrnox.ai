import { useCallback, useEffect, useState } from 'react';
import type { ApiClient } from './api';
import { parseGenerationCatalog, type GenerationCatalogPlan } from './billing';

export type PlanCatalogStatus = 'loading' | 'ready' | 'error';
export interface PlanCatalog {
    readonly catalog: readonly GenerationCatalogPlan[];
    readonly status: PlanCatalogStatus;
    readonly retry: () => void;
}

// How many credits each plan includes, from the server's public plan list. Prices come from the store, never from
// here. A failure is reported (status 'error') rather than swallowed, and retry() asks again; nothing is invented.
export function usePlanCatalog(api: Pick<ApiClient, 'request'>): PlanCatalog {
    const [catalog, setCatalog] = useState<readonly GenerationCatalogPlan[]>([]);
    const [status, setStatus] = useState<PlanCatalogStatus>('loading');
    const [attempt, setAttempt] = useState(0);
    useEffect(() => {
        let live = true;
        setStatus('loading');
        api.request<unknown>('/api/credit-subscription-plans').then(
            (value) => { if (live) { setCatalog(parseGenerationCatalog(value)); setStatus('ready'); } },
            () => { if (live) setStatus('error'); },
        );
        return () => { live = false; };
    }, [api, attempt]);
    const retry = useCallback(() => setAttempt(n => n + 1), []);
    return { catalog, status, retry };
}
