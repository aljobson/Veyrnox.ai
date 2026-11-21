import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { ResultBatch } from '../create/CreateResult';
import { ApiError, type ApiClient } from '../../lib/api';
import { getCacheUser, subscribeCacheUser } from '../../lib/appCache';
import { refreshBalance } from '../../lib/createResult';
import { generationMessage, generationSignature, type SubmitRequest, type ChargeSnapshot } from '../../lib/generationSubmit';
import type { CatalogModel } from '../../lib/media';
import { shortfall } from '../../lib/lowBalance';
import { auditionBatchNote } from '../../lib/speech/audition';
import { createSpeechSubmit, type SpeechFailure } from '../../lib/speech/speechLedger';
import type { AuditionJob } from './AuditionResults';

export function useSpeechSubmission(api: ApiClient, onOwnerChanged: () => void) {
    const [jobs, setJobs] = useState<AuditionJob[]>([]);
    const [complete, setComplete] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);
    const [result, setResult] = useState<ResultBatch | null>(null);
    const [priceOverrides, setPriceOverrides] = useState<Record<string, number>>({});
    const pending = useRef(createSpeechSubmit());
    useSyncExternalStore(pending.current.subscribe, pending.current.version, pending.current.version);
    const epoch = useRef(0), balanceSeq = useRef(0), sending = useRef(false);
    const mounted = useRef(false);
    const ownerChanged = useRef(onOwnerChanged); ownerChanged.current = onOwnerChanged;
    useEffect(() => {
        mounted.current = true;
        const unsubscribe = subscribeCacheUser(() => { resetAttempt(); setPriceOverrides({}); ownerChanged.current(); });
        return () => { mounted.current = false; unsubscribe(); epoch.current++; balanceSeq.current++; };
    }, []);
    function resetAttempt() {
        epoch.current++; balanceSeq.current++;
        sending.current = false; setBusy(false);
        setResult(null); setJobs([]); setComplete(false); setError(null);
        if (!pending.current.hasUnresolvedEntries()) setPriceOverrides({});
    }
    function editAttempt(changed: boolean) {
        if (!changed) return;
        resetAttempt();
    }
    // A server-corrected price belongs to the request it was returned for; the signature ignores confirmedCredits.
    function priceFor(request: SubmitRequest | null, count: number): number | null {
        return request ? priceOverrides[generationSignature(request, count)] ?? null : null;
    }
    function visibleJobs(request: SubmitRequest | null, voices: readonly string[]): AuditionJob[] {
        if (complete) return jobs;
        if (!request || !voices.length) return [];
        const seen = new Set<string>();
        return pending.current.accepted(request, voices.length).flatMap(({ jobId, index }) => {
            if (seen.has(jobId)) return [];
            seen.add(jobId);
            return [{ id: jobId, voice: voices[index] }];
        });
    }
    async function generate(request: SubmitRequest | null, model: CatalogModel, voices: readonly string[], quote: ChargeSnapshot, balance: number | null) {
        const boardActive = voices.length > 0, count = boardActive ? voices.length : 1;
        if (!model || !request || sending.current || result || complete || shortfall(balance, quote.payable) > 0) return;
        sending.current = true; setBusy(true); setError(null); setJobs([]);
        let started = 0, failure: SpeechFailure | undefined;
        const currentJobs: (AuditionJob | undefined)[] = Array(count);
        const generation = epoch.current, owner = getCacheUser();
        const current = () => mounted.current && generation === epoch.current && owner === getCacheUser();
        const signature = generationSignature(request, count);
        try {
            await pending.current.run(api, request, count, value => { started = value; }, (id, index) => {
                if (!current()) return;
                if (boardActive) {
                    currentJobs[index] = { id, voice: voices[index] };
                    const seen = new Set<string>();
                    setJobs(currentJobs.filter((job): job is AuditionJob => {
                        if (!job || seen.has(job.id)) return false;
                        seen.add(job.id); return true;
                    }));
                } else setResult({ ids: [id], modelId: model.id, kind: 'audio', aspect: null, duration: null, count: 1 });
            }, quote, value => { failure = value; }, current);
            if (current()) setPriceOverrides(previous => Object.fromEntries(Object.entries(previous).filter(([key]) => key !== signature)));
            if (current() && boardActive) setComplete(true);
        } catch (cause) {
            if (!current()) return;
            if (cause instanceof ApiError && cause.code === 'price_changed' && Number.isInteger(cause.body.expected_credits) && Number(cause.body.expected_credits) >= 0) setPriceOverrides(previous => ({ ...previous, [signature]: Number(cause.body.expected_credits) }));
            setError(boardActive && failure ? `${auditionBatchNote(started, voices, failure.index, failure.unknown)} ${generationMessage(cause)}` : generationMessage(cause));
        } finally {
            if (current()) {
                sending.current = false; setBusy(false);
                void refreshBalance(api, owner, current, balanceSeq);
            }
        }
    }
    const generation = epoch.current, owner = getCacheUser();
    const settled = () => { if (mounted.current && generation === epoch.current && owner === getCacheUser()) void refreshBalance(api, owner, () => mounted.current && generation === epoch.current, balanceSeq); };
    return { pending, sending, busy, result, visibleJobs, complete, error, setError, priceFor, resetAttempt, editAttempt, generate, settled };
}
