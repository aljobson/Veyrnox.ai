import { isBalance } from './responseShapes';
import { ApiError } from './api';
import { subscribeBalance } from './balanceEvents';
import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '../auth/AuthProvider';
import { appCache, getCacheUser, subscribeCacheUser } from './appCache';
import { POLICIES } from './cache';
import { observe } from './network';

// The credits balance, refreshed whenever the screen comes into view. Null until it is known or if it cannot be read.
export function useBalance(): number | null {
    const { api } = useAuth();
    const [balance, setBalance] = useState<number | null>(null);
    const [owner, setOwner] = useState(getCacheUser());
    const read = useRef(0);
    const mounted = useRef(true);
    useEffect(() => {
        mounted.current = true;
        const unsubscribe = subscribeCacheUser(() => {
            read.current++; setBalance(null); setOwner(getCacheUser());
        });
        return () => { mounted.current = false; read.current++; unsubscribe(); };
    }, []);
    useEffect(() => subscribeBalance((user, next) => {
        read.current++;
        if (mounted.current && user === getCacheUser()) setBalance(next);
    }), []);
    useFocusEffect(
        useCallback(() => {
            const version = ++read.current;
            void appCache
                .swr({ policy: POLICIES.balance, userId: owner, fetcher: () => observe(api.getBalance()), onData: (v) => {
                    if (version === read.current && owner === getCacheUser() && mounted.current) setBalance(v.balance);
                } })
                .catch(() => {});
        }, [api, owner]),
    );
    return balance;
}


// Details are display state; a numeric publication preserves the current free-credit fields.
export function useBalanceDetails() {
    const { api } = useAuth();
    const [owner, setOwner] = useState(getCacheUser());
    const [details, setDetails] = useState<import('./api').Balance | null>(null);
    const [failed, setFailed] = useState(false);
    const revision = useRef(0);
    // Numeric events supersede the amount, but do not invalidate free fields from an in-flight read.
    const publication = useRef({ version: 0, balance: 0 });
    useEffect(() => subscribeCacheUser(() => {
        revision.current++; setDetails(null); setFailed(false); setOwner(getCacheUser());
    }), []);
    useEffect(() => subscribeBalance((user, balance) => {
        if (user === getCacheUser()) {
            publication.current = { version: publication.current.version + 1, balance };
            setDetails(previous => ({ balance, free_credits: previous?.free_credits ?? 0, free_expires_at: previous?.free_expires_at ?? null }));
        }
    }), []);
    const refresh = useCallback(async () => {
        const version = ++revision.current;
        const publishedVersion = publication.current.version;
        const user = getCacheUser();
        try {
            const next = await observe(api.getBalance());
            if (!isBalance(next)) throw new ApiError(200, 'bad_response');
            if (user === getCacheUser() && version === revision.current) { setDetails({ ...next, balance: publishedVersion === publication.current.version ? next.balance : publication.current.balance }); setFailed(false); }
        } catch (error) {
            if (user === getCacheUser() && version === revision.current) setFailed(true);
            throw error;
        }
    }, [api]);
    useFocusEffect(useCallback(() => {
        const version = ++revision.current;
        const publishedVersion = publication.current.version;
        void appCache.swr({ policy: POLICIES.balance, userId: owner, fetcher: () => observe(api.getBalance()),
            onData: next => {
                if (owner === getCacheUser() && version === revision.current) { setDetails({ ...next, balance: publishedVersion === publication.current.version ? next.balance : publication.current.balance }); setFailed(false); }
            },
        }).catch(() => { if (owner === getCacheUser() && version === revision.current) setFailed(true); });
    }, [api, owner]));
    return { details, failed, refresh };
}
