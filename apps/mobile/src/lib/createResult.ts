import { useEffect, useState } from 'react';
import { ApiError, type ApiClient } from './api';
import { getCacheUser, subscribeCacheUser } from './appCache';
import { publishBalance } from './balanceEvents';
import { mediaApi, waitForJob, type CatalogModel, type JobState } from './media';

type JobStatus = Awaited<ReturnType<ReturnType<typeof mediaApi>['getJob']>>;
export interface JobResult {
    state: JobState;
    job?: JobStatus;
    asset?: Awaited<ReturnType<ReturnType<typeof mediaApi>['getAsset']>>;
    held?: boolean;
    error?: boolean;
}
export async function refreshBalance(api: ApiClient, owner: string | undefined, isCurrent: () => boolean, balanceSeq: { current: number }): Promise<void> {
    const seq = ++balanceSeq.current;
    try {
        const result = await api.getBalance();
        if (owner && owner === getCacheUser() && isCurrent() && seq === balanceSeq.current) publishBalance(owner, result.balance);
    } catch { /* The balance hook retains its last confirmed read. */ }
}
export function useJobResult(api: ApiClient, id: string): JobResult {
    const [result, setResult] = useState<JobResult>({ state: 'queued' });
    useEffect(() => {
        const controller = new AbortController();
        const owner = getCacheUser();
        const current = () => !controller.signal.aborted && owner === getCacheUser();
        const unsubscribe = subscribeCacheUser(() => { controller.abort(); setResult({ state: 'queued' }); });
        const media = mediaApi(api);
        const sleep = (ms: number) => new Promise<void>(resolve => {
            const done = () => { clearTimeout(timer); controller.signal.removeEventListener('abort', done); resolve(); };
            const timer = setTimeout(done, ms);
            controller.signal.addEventListener('abort', done, { once: true });
        });
        setResult({ state: 'queued' });
        void (async () => {
            try {
                const state = await waitForJob(media, id, state => { if (current()) setResult(r => ({ ...r, state })); }, controller.signal, sleep);
                if (!current()) return;
                let job = await media.getJob(id);
                if (!current()) return;
                setResult({ state, job });
                if (state === 'succeeded') {
                    const asset = await media.getAsset(id);
                    if (current()) setResult({ state, job, asset });
                } else if (state === 'failed') {
                    for (let tries = 0; !job.refunded && tries < 6 && current(); tries++) {
                        await sleep(5000);
                        if (!current()) return;
                        try { job = await media.getJob(id); } catch { continue; }
                        if (current()) setResult({ state, job });
                    }
                }
            } catch (error) {
                if (current()) setResult(r => ({ ...r, ...(error instanceof ApiError && error.code === 'held' ? { held: true } : { error: true }) }));
            }
        })();
        return () => { controller.abort(); unsubscribe(); };
    }, [api, id]);
    return result;
}
export function soundPassFor({ catalog, modelId, durationSeconds, result }: {
    catalog: readonly CatalogModel[]; modelId: string; durationSeconds: number | null; result: JobResult;
}): { kind: 'eligible' } | { kind: 'tooLong'; seconds: number } | null {
    if (result.state !== 'succeeded' || !result.asset?.mime_type.startsWith('video/') || (result.job?.model_id ?? modelId) === 'mmaudio-v2-video') return null;
    const sound = catalog.find(m => m.id === 'mmaudio-v2-video');
    const seconds = sound?.capabilities?.media?.video?.maxSeconds;
    if (!seconds || !durationSeconds || durationSeconds <= 0) return null;
    return durationSeconds <= seconds ? { kind: 'eligible' } : { kind: 'tooLong', seconds };
}
