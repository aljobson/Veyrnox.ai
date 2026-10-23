import { subscribeBalance } from './balanceEvents';
import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '../auth/AuthProvider';
import { appCache, getCacheUser } from './appCache';
import { POLICIES } from './cache';
import { observe } from './network';

// The credits balance, refreshed whenever the screen comes into view. Null until it is known or if it cannot be read.
export function useBalance(): number | null {
    const { api } = useAuth();
    const [balance, setBalance] = useState<number | null>(null);
    const revision = useRef(0);
    useEffect(() => subscribeBalance((owner, next) => {
        if (owner === getCacheUser()) { revision.current++; setBalance(next); }
    }), []);
    useFocusEffect(
        useCallback(() => {
            const version = revision.current;
            const owner = getCacheUser();
            void appCache
                .swr({ policy: POLICIES.balance, userId: owner, fetcher: () => observe(api.getBalance()), onData: (v) => { if (version === revision.current && owner === getCacheUser()) setBalance(v.balance); } })
                .catch(() => {});
        }, [api]),
    );
    return balance;
}
