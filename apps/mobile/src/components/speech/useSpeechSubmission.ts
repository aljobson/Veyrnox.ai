import { useEffect, useRef, useState } from 'react';
import type { ResultBatch } from '../create/CreateResult';
import { ApiError, type ApiClient } from '../../lib/api';
import { getCacheUser, subscribeCacheUser } from '../../lib/appCache';
import { refreshBalance } from '../../lib/createResult';
import { createGenerationSubmit, generationMessage, type SubmitRequest, type ChargeSnapshot } from '../../lib/generationSubmit';
import type { CatalogModel } from '../../lib/media';
import { rememberSubmitted } from '../../lib/submittedRequests';
import { DEFAULT_CINEMA } from '../../lib/cinemaCamera';
import { shortfall } from '../../lib/lowBalance';
import { auditionBatchNote } from '../../lib/speech/audition';
import type { AuditionJob } from './AuditionResults';

export function useSpeechSubmission(api: ApiClient, onOwnerChanged: () => void) {
    const [jobs, setJobs] = useState<AuditionJob[]>([]);
    const [complete, setComplete] = useState(false);
    const [attempted, setAttempted] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);
    const [result, setResult] = useState<ResultBatch | null>(null);
    const [priceOverride, setPriceOverride] = useState<number | null>(null);
    const pending = useRef(createGenerationSubmit());
    const epoch = useRef(0), balanceSeq = useRef(0), sending = useRef(false);
    const ownerChanged = useRef(onOwnerChanged); ownerChanged.current = onOwnerChanged;
    useEffect(() => {
        const unsubscribe = subscribeCacheUser(() => { resetAttempt(); ownerChanged.current(); });
        return () => { unsubscribe(); epoch.current++; balanceSeq.current++; };
    }, []);
    function resetAttempt() {
        epoch.current++; balanceSeq.current++; pending.current.reset();
        setResult(null); setJobs([]); setComplete(false); setAttempted(false); setError(null); setPriceOverride(null);
    }
    async function generate(request: SubmitRequest | null, model: CatalogModel, voices: readonly string[], quote: ChargeSnapshot, balance: number | null) {
        const boardActive = voices.length > 0, count = boardActive ? voices.length : 1;
        if (!model || !request || sending.current || result || complete || shortfall(balance, quote.payable) > 0) return;
        sending.current = true; setBusy(true); setError(null); setAttempted(true);
        let started = jobs.length;
        const generation = epoch.current, owner = getCacheUser();
        const current = () => generation === epoch.current && owner === getCacheUser();
        try {
            await pending.current.run(api, request, count, value => { started = value; }, (id, index) => {
                if (!current()) return;
                const { inputsByIndex, ...baseRequest } = request;
                const itemRequest = { ...baseRequest, extraInputs: inputsByIndex?.[index] ?? request.extraInputs };
                void rememberSubmitted(id, itemRequest, { prompt: request.prompt }, {
                    opts: { aspect: null, count: 1, seed: '', negative: '', voice: '', audioSeconds: '' },
                    cameraOn: false, cinema: DEFAULT_CINEMA, characterOn: false, character: {},
                }).catch(() => undefined);
                if (boardActive) setJobs(previous => [...previous, { id, voice: voices[index] }]);
                else setResult({ ids: [id], modelId: model.id, kind: 'audio', aspect: null, duration: null, count: 1 });
            }, quote);
            if (current() && boardActive) setComplete(true);
        } catch (cause) {
            if (!current()) return;
            if (cause instanceof ApiError && cause.code === 'price_changed' && Number.isInteger(cause.body.expected_credits) && Number(cause.body.expected_credits) >= 0) setPriceOverride(Number(cause.body.expected_credits));
            setError(boardActive ? `${auditionBatchNote(started, voices, pending.current.hasUnknownOutcome(request, count))} ${generationMessage(cause)}` : generationMessage(cause));
        } finally {
            sending.current = false; setBusy(false);
            if (current()) void refreshBalance(api, owner, current, balanceSeq);
        }
    }
    const generation = epoch.current, owner = getCacheUser();
    const settled = () => { if (generation === epoch.current && owner === getCacheUser()) void refreshBalance(api, owner, () => generation === epoch.current, balanceSeq); };
    return { pending, sending, busy, result, jobs, complete, attempted, error, setError, priceOverride, resetAttempt, generate, settled };
}
