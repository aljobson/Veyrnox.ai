import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { useAuth } from '../auth/AuthProvider';
import { appCache, getCacheUser } from './appCache';
import { POLICIES } from './cache';
import { observe } from './network';

// The credits balance, refreshed whenever the screen comes into view. Null until it is known or if it cannot be read.
export function useBalance(): number | null {
    const { api } = useAuth();
    const [balance, setBalance] = useState<number | null>(null);
    useFocusEffect(
        useCallback(() => {
            void appCache
                .swr({ policy: POLICIES.balance, userId: getCacheUser(), fetcher: () => observe(api.getBalance()), onData: (v) => setBalance(v.balance) })
                .catch(() => {});
        }, [api]),
    );
    return balance;
}
