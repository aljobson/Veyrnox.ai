import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { useFocusEffect } from 'expo-router';
import type { ApiClient } from './api';
import { getCacheUser, subscribeCacheUser } from './appCache';
import { mediaApi } from './media';
import { findResumableAgentJob } from './montage';

export function useAgentResume(api: ApiClient): { job: { jobId: string; credits: number } | null; check: () => void } {
    const [job, setJob] = useState<{ jobId: string; credits: number } | null>(null);
    const read = useRef(0);
    const mounted = useRef(true);
    const check = useCallback(() => {
        const version = ++read.current;
        const owner = getCacheUser();
        const isCurrent = () => version === read.current && owner === getCacheUser() && mounted.current;
        void (async () => {
            try {
                const next = await findResumableAgentJob(cursor => mediaApi(api).listJobs(cursor), isCurrent);
                if (isCurrent() && next !== undefined) setJob(next);
            } catch {
                if (isCurrent()) setJob(null);
            }
        })();
    }, [api]);

    useEffect(() => {
        mounted.current = true;
        const unsubscribe = subscribeCacheUser(() => {
            read.current++;
            setJob(null);
            check();
        });
        return () => { mounted.current = false; read.current++; unsubscribe(); };
    }, [check]);

    useFocusEffect(useCallback(() => {
        check();
        const listener = AppState.addEventListener('change', state => { if (state === 'active') check(); });
        return () => { listener.remove(); read.current++; };
    }, [check]));
    return { job, check };
}
