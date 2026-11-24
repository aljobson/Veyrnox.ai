import { useEffect, useRef, useState } from 'react';
import { Alert, View } from 'react-native';
import { Button, Text } from '../ui';
import { plural, t } from '../../lib/i18n';
import { ApiError, type ApiClient } from '../../lib/api';
import { cancelErrorKey, cancelJob, getMusicCancelProbe, type CancelStatus } from '../../lib/cancelJob';
import type { MusicCandidateView } from '../../lib/music/types';

const PROBE_INTERVAL_MS = 15_000;

export function MusicCandidateCancel({ candidate, api, refresh, afterCancel }: {
    candidate: MusicCandidateView; api: ApiClient; refresh: () => void | Promise<unknown>;
    afterCancel?: () => void | Promise<unknown>;
}) {
    const [status, setStatus] = useState<CancelStatus | null>(null);
    const [busy, setBusy] = useState(false);
    const [note, setNote] = useState<string | null>(null);
    const locked = useRef(false);
    const settled = useRef(false);
    const probeControl = useRef<{ schedule(delay?: number): void; stop(): void } | null>(null);
    const jobId = candidate.job_id;
    const queued = candidate.state === 'queued' && !!jobId;

    useEffect(() => {
        if (!queued || !jobId) return;
        settled.current = false;
        let stopped = false, timer: ReturnType<typeof setTimeout> | undefined;
        const schedule = (delay = PROBE_INTERVAL_MS) => {
            clearTimeout(timer);
            if (!stopped && !settled.current) timer = setTimeout(() => void probe(), Math.max(PROBE_INTERVAL_MS, delay));
        };
        const stop = () => clearTimeout(timer);
        probeControl.current = { schedule, stop };
        const probe = async () => {
            if (stopped || settled.current || locked.current) return;
            const result = await getMusicCancelProbe(api, jobId);
            if (stopped || settled.current || locked.current) return;
            if (result.kind === 'retry') { setStatus(null); schedule(result.retryAfterMs); return; }
            if (result.kind === 'hidden') { setStatus(null); return; }
            if (!result.status.cancellable) { setStatus(null); schedule(); return; }
            setStatus(result.status); setNote(null); schedule();
        };
        void probe();
        return () => { stopped = true; stop(); if (probeControl.current?.stop === stop) probeControl.current = null; };
    }, [api, jobId, queued]);

    async function run() {
        if (locked.current || !jobId || !status?.cancellable) return;
        locked.current = true; setBusy(true); setNote(null);
        try {
            const result = await cancelJob(api, jobId);
            settled.current = true; probeControl.current?.stop();
            setStatus(null);
            setNote(result.credits > 0 ? plural('jobCancel.cancelled', result.credits) : t('jobCancel.cancelledFree'));
            await Promise.allSettled([Promise.resolve(refresh()), Promise.resolve(afterCancel?.())]);
        } catch (error) {
            const key = cancelErrorKey(error);
            setNote(t(key));
            setStatus(null);
            if (['jobCancel.finished', 'jobCancel.unavailable'].includes(key)) {
                settled.current = true; probeControl.current?.stop();
            } else {
                const retry = key === 'jobCancel.rateLimited' && error instanceof ApiError
                    ? Math.max(PROBE_INTERVAL_MS, (error.retryAfterSeconds ?? 60) * 1000) : PROBE_INTERVAL_MS;
                probeControl.current?.schedule(retry);
            }
            if (key === 'jobCancel.unsure') await Promise.resolve(refresh()).catch(() => {});
        } finally { locked.current = false; setBusy(false); }
    }

    function confirm() {
        if (locked.current || !status?.cancellable) return;
        Alert.alert(t('jobCancel.confirmTitle'), status.credits > 0
            ? plural('jobCancel.confirmPaid', status.credits) : t('jobCancel.confirmFree'), [
            { text: t('jobCancel.keep'), style: 'cancel' },
            { text: t('jobCancel.confirmAction'), style: 'destructive', onPress: () => void run() },
        ]);
    }

    if (!queued || (!status?.cancellable && !note)) return null;
    return <View style={{ gap: 8 }}>
        {note ? <Text accessibilityLiveRegion="polite">{note}</Text> : null}
        {status?.cancellable ? <Button variant="secondary" accessibilityRole="button"
            accessibilityState={{ busy, disabled: busy }} disabled={busy}
            label={t(busy ? 'jobCancel.cancelling' : 'jobCancel.confirm')} onPress={confirm} /> : null}
    </View>;
}
