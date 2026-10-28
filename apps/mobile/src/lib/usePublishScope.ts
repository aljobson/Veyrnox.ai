import { useCallback, useEffect, useRef, useState } from 'react';
import type { ApiClient } from './api';
import { subscribeCacheUser } from './appCache';
import { brandStore } from './publishBrand';
import { publishScope } from './usePublishRole';

// Scope generations reject A → B → A completions; read counters also order reads within A.
export function usePublishScope(api: ApiClient, onReset: () => void) {
    const generation = useRef(0), reads = useRef(new Map<string, number>());
    const currentApi = useRef(api), resetRef = useRef(onReset);
    currentApi.current = api; resetRef.current = onReset;
    const [scopeTick, setScopeTick] = useState(0);
    const guard = useCallback(() => {
        const version = generation.current, scope = publishScope();
        return () => version === generation.current && scope === publishScope() && currentApi.current === api;
    }, [api]);
    const nextRead = useCallback((key: string) => {
        const valid = guard(), sequence = (reads.current.get(key) ?? 0) + 1;
        reads.current.set(key, sequence);
        return () => valid() && reads.current.get(key) === sequence;
    }, [guard]);
    useEffect(() => {
        const reset = () => {
            generation.current++;
            resetRef.current();
            setScopeTick(tick => tick + 1);
        };
        const userOff = subscribeCacheUser(reset), brandOff = brandStore.subscribe(reset);
        return () => { generation.current++; userOff(); brandOff(); };
    }, []);
    return { guard, nextRead, scopeTick };
}
