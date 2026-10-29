import { useEffect, useRef, useState } from 'react';
import { ApiError, type ApiClient } from './api';
import { getCacheUser, subscribeCacheUser } from './appCache';
import { publishBalance } from './balanceEvents';
import { fetchFreeAllowance, type FreeLeft } from './freeAllowance';
import { createGenerationSubmit, generationMessage, type SubmitRequest } from './generationSubmit';
import { t } from './i18n';
import { mediaApi, waitForJob, type JobState } from './media';

export interface MakeJob {
    id: string;
    state: JobState;
    asset?: { url: string; mime_type: string };
}
type Retained = { signature: string; started: number; blocked: boolean };

// Keys belong to the mounted panel, while results and reads belong to a visible batch.
export function useMakePanelState(api: ApiClient, visible: boolean) {
    const submit = useRef(createGenerationSubmit());
    const mounted = useRef(true), batch = useRef(0), active = useRef(false);
    const controller = useRef(new AbortController());
    const allowanceRead = useRef(0), balanceRead = useRef(0);
    const seen = useRef(new Set<string>());
    const retained = useRef<Retained | null>(null);
    const [retry, setRetry] = useState<Retained | null>(null);
    const [jobs, setJobs] = useState<MakeJob[]>([]);
    const [submitting, setSubmitting] = useState(false);
    const [freeMap, setFreeMap] = useState<FreeLeft>({});
    const [error, setError] = useState<string | null>(null);
    const [note, setNote] = useState<string | null>(null);
    const [lowBalance, setLowBalance] = useState(false);
    const [count, setCount] = useState(1);
    const current = (id: number, owner: string | undefined) => mounted.current && batch.current === id && getCacheUser() === owner;

    function clear() {
        batch.current++;
        allowanceRead.current++;
        controller.current.abort();
        controller.current = new AbortController();
        seen.current.clear();
        setJobs([]); setError(null); setNote(null); setLowBalance(false);
    }
    async function refreshAllowance(id: number, owner: string | undefined) {
        const read = ++allowanceRead.current;
        try {
            const next = await fetchFreeAllowance(api);
            if (read === allowanceRead.current && current(id, owner) && !active.current) setFreeMap(next);
        } catch { /* The paid estimate remains when allowance cannot be read. */ }
    }
    async function refreshBalance(id: number, owner: string | undefined) {
        const read = ++balanceRead.current;
        try {
            const next = await api.getBalance();
            if (owner && read === balanceRead.current && current(id, owner)) publishBalance(owner, next.balance);
        } catch { /* Unknown balance must not prevent a server-checked purchase. */ }
    }
    useEffect(() => {
        mounted.current = true;
        return () => { mounted.current = false; batch.current++; controller.current.abort(); };
    }, []);
    useEffect(() => {
        clear(); setFreeMap({});
        if (visible) void refreshAllowance(batch.current, getCacheUser());
        // The API and visibility define a new panel session, not rerenders of its form.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [visible, api]);
    useEffect(() => subscribeCacheUser(() => {
        clear(); setFreeMap({}); retained.current = null; setRetry(null);
        // Do not reset keys under a pending run. A changed account cannot reuse its request.
        if (!active.current) submit.current.reset();
    }), []);

    function addJob(id: string, run: number, owner: string | undefined, signal: AbortSignal) {
        if (!current(run, owner) || signal.aborted || seen.current.has(id)) return;
        seen.current.add(id);
        setJobs(all => [...all, { id, state: 'queued' }]);
        const update = (patch: Partial<MakeJob>) => {
            if (current(run, owner) && !signal.aborted) setJobs(all => all.map(job => job.id === id ? { ...job, ...patch } : job));
        };
        const media = mediaApi(api);
        void waitForJob(media, id, state => update({ state }), signal).then(async state => {
            if (state !== 'succeeded' || !current(run, owner) || signal.aborted) return;
            try { update({ asset: await media.getAsset(id) }); } catch { /* Status alone is useful. */ }
        }).catch(() => {});
    }
    async function run(request: SubmitRequest, n: number, onStarted?: (jobId: string) => void) {
        if (active.current) return;
        const owner = getCacheUser();
        const signature = JSON.stringify({ ...request, count: n });
        const same = retained.current?.signature === signature;
        if (!same) clear();
        const id = batch.current, signal = controller.current.signal;
        const record = same ? retained.current! : { signature, started: 0, blocked: false };
        retained.current = record;
        active.current = true; setSubmitting(true); setCount(n);
        allowanceRead.current++; setFreeMap({});
        setError(null); setNote(null); setLowBalance(false);
        try {
            await submit.current.run(api, request, n, started => {
                if (retained.current === record && getCacheUser() === owner) record.started = Math.max(record.started, started);
            }, jobId => { if (getCacheUser() === owner) onStarted?.(jobId); addJob(jobId, id, owner, signal); });
            if (retained.current === record && getCacheUser() === owner) {
                retained.current = null;
                if (mounted.current) setRetry(null);
            }
        } catch (err) {
            // Closing drops presentation callbacks, but the retained purchase must still
            // describe its real outcome when the same mounted panel opens again.
            if (retained.current === record && getCacheUser() === owner) {
                record.blocked = record.started > 0 || !(err instanceof ApiError) || err.code === 'network';
                if (mounted.current) setRetry({ ...record });
            }
            if (current(id, owner)) {
                const credits = err instanceof ApiError && ['insufficient_balance', 'insufficient_credits'].includes(err.code);
                setLowBalance(credits);
                setError(credits ? t('chat.make.err.credits') : err instanceof ApiError && err.code === 'rate_limited' ? t('chat.make.err.rate') : generationMessage(err));
                if (n > 1) setNote(t(err instanceof ApiError && err.code !== 'network' ? 'opt.started' : 'opt.startedUnknown', { started: String(record.started), count: String(n), next: String(record.started + 1) }));
            }
        } finally {
            active.current = false;
            if (getCacheUser() !== owner) submit.current.reset();
            if (mounted.current) setSubmitting(false);
            void refreshBalance(id, owner);
            void refreshAllowance(id, owner);
        }
    }
    function makeAnother() {
        if (active.current || retained.current?.blocked) return false;
        clear(); submit.current.reset(); retained.current = null; setRetry(null);
        return true;
    }
    return { jobs, count, submitting, freeMap, error, note, lowBalance, retry, run, close: clear, makeAnother };
}
