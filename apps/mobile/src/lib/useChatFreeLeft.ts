import { useEffect, useRef, useState } from 'react';
import type { ApiClient } from './api';
import { fetchFreeAllowance, type FreeLeft } from './freeAllowance';

export function useChatFreeLeft(api: ApiClient, round: number) {
    const latest = useRef(round); latest.current = round;
    const [data, setData] = useState<{ left: FreeLeft; loadedFor: number | null }>({ left: {}, loadedFor: null });
    useEffect(() => {
        let active = true;
        void fetchFreeAllowance(api).catch(() => ({})).then(left => {
            if (active && latest.current === round) setData({ left, loadedFor: round });
        });
        return () => { active = false; };
    }, [api, round]);
    return data;
}
