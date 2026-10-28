import { useEffect, useState } from 'react';
import { useAuth } from '../auth/AuthProvider';
import { getCacheUser, subscribeCacheUser } from './appCache';
import { fetchFreeAllowance, type FreeLeft } from './freeAllowance';

// Never show a previous run's free price while its replacement read is pending.
export function useFreeLeftState(refreshKey = 0): { left: FreeLeft; loading: boolean } {
    const { api } = useAuth();
    const [account, setAccount] = useState(0);
    const [snapshot, setSnapshot] = useState<{ api: typeof api; key: number; account: number; left: FreeLeft } | null>(null);
    useEffect(() => subscribeCacheUser(() => { setSnapshot(null); setAccount(n => n + 1); }), []);
    useEffect(() => {
        let live = true;
        const owner = getCacheUser();
        fetchFreeAllowance(api).catch(() => ({})).then(left => {
            if (live && owner === getCacheUser()) setSnapshot({ api, key: refreshKey, account, left });
        });
        return () => { live = false; };
    }, [api, refreshKey, account]);
    const current = snapshot?.api === api && snapshot.key === refreshKey && snapshot.account === account;
    return { left: current ? snapshot.left : {}, loading: !current };
}
export function useFreeLeft(): FreeLeft { return useFreeLeftState().left; }
