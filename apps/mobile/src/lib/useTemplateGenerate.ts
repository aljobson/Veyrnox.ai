import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '../auth/AuthProvider';
import { ApiError } from './api';
import { getCacheUser, subscribeCacheUser } from './appCache';
import { refreshBalance } from './createResult';
import { fetchFreeAllowance } from './freeAllowance';
import { createGenerationSubmit, generationMessage, generationSignature, type ChargeSnapshot, type SubmitRequest } from './generationSubmit';
import { freeLeftFor } from './createOptions';
import { useBalance } from './useBalance';
import { useFreeLeftState } from './useFreeLeft';
import { shortfall } from './lowBalance';

export interface TemplateRun { readonly ids: readonly string[]; readonly modelId: string }

// The template page's Generate. It follows Create's generate() for one item: createGenerationSubmit keeps the
// idempotency key across a retry of the same request, the quote caps the charge (max_charge_credits), a price change
// asks for a fresh confirmation, and any change to the request drops the continuation.
export function useTemplateGenerate(request: SubmitRequest | null, unit: number) {
    const { api } = useAuth();
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [run, setRun] = useState<TemplateRun | null>(null);
    const [refreshKey, setRefreshKey] = useState(0);
    const { left: freeMap, loading: freeLoading } = useFreeLeftState(refreshKey);
    const balance = useBalance();
    const batch = useRef(0);
    const balanceSeq = useRef(0);
    const pending = useRef(createGenerationSubmit());
    const retry = useRef<{ signature: string; unit: number; quote?: ChargeSnapshot } | null>(null);
    const signature = request ? generationSignature(request, 1) : '';

    const reset = useCallback(() => {
        batch.current++; balanceSeq.current++; pending.current.reset(); retry.current = null;
        setRun(null); setError(null);
    }, []);
    useEffect(() => subscribeCacheUser(() => { reset(); setBusy(false); }), [reset]);
    // A changed request (prompt, model, length, shape) starts a new quote and a new key, even if changed back.
    useEffect(() => { if (retry.current && retry.current.signature !== signature) reset(); }, [signature, reset]);

    const matching = retry.current?.signature === signature ? retry.current : null;
    const freeLeft = freeLoading || !request ? 0 : freeLeftFor(freeMap, request.modelId);
    const quote = request ? matching?.quote ?? pending.current.snapshot(request, 1, matching?.unit ?? unit, freeLeft) : null;
    const price = quote?.total ?? unit;
    const payable = quote?.payable ?? price;
    const missing = run ? 0 : shortfall(balance, payable);
    const confirming = !!matching?.quote;

    async function generate() {
        if (!request || busy || freeLoading) return;
        const used: { signature: string; unit: number; quote?: ChargeSnapshot } = matching ?? { signature, unit };
        retry.current = used;
        const generation = batch.current;
        const owner = getCacheUser();
        const current = () => generation === batch.current && owner === getCacheUser();
        setBusy(true); setError(null);
        try {
            await pending.current.run(api, request, 1, undefined, (id) => {
                if (!current()) return;
                setRun({ ids: [id], modelId: request.modelId });
            }, quote ?? undefined);
            if (current()) retry.current = null;
        } catch (err) {
            if (!current()) return;
            if (err instanceof ApiError && err.code === 'price_changed' && Number.isInteger(err.body.expected_credits) && Number(err.body.expected_credits) >= 0) {
                let fresh = {};
                try { fresh = await fetchFreeAllowance(api); } catch { /* paid estimate */ }
                if (!current()) return;
                const quotedUnit = Number(err.body.expected_credits);
                retry.current = { ...used, unit: quotedUnit, quote: pending.current.snapshot(request, 1, quotedUnit, freeLeftFor(fresh, request.modelId)) };
            } else retry.current = { ...used, quote: undefined };
            setError(generationMessage(err));
        } finally {
            setBusy(false);
            if (current()) { setRefreshKey(key => key + 1); void refreshBalance(api, owner, current, balanceSeq); }
        }
    }
    const settled = () => { const generation = batch.current; const owner = getCacheUser(); void refreshBalance(api, owner, () => generation === batch.current, balanceSeq); };

    return { api, busy, error, run, price, missing, confirming, freeLoading, generate, reset, settled, ready: !!request && !busy && !freeLoading && missing === 0 };
}
