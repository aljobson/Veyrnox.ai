import { useEffect, useRef, useState } from 'react';
import type { ApiClient } from './api';
import { getCacheUser, subscribeCacheUser } from './appCache';
import { brandStore } from './publishBrand';
import { fetchAccounts, type PublishRole } from './publish';

export const publishScope = () => JSON.stringify([getCacheUser() ?? null, brandStore.get()]);

export function usePublishRole(api: ApiClient): PublishRole | null {
    const currentApi = useRef(api);
    currentApi.current = api;
    const [answer, setAnswer] = useState<{ api: ApiClient; scope: string; role: PublishRole } | null>(null);
    useEffect(() => {
        let generation = 0, live = true;
        const load = () => {
            const version = ++generation, scope = publishScope();
            setAnswer(null);
            const valid = () => live && version === generation && scope === publishScope() && api === currentApi.current;
            Promise.resolve().then(() => fetchAccounts(api)).then(
                state => { if (valid()) setAnswer({ api, scope, role: state.brandRole }); },
                () => { if (valid()) setAnswer({ api, scope, role: 'viewer' }); },
            );
        };
        const userOff = subscribeCacheUser(load), brandOff = brandStore.subscribe(load);
        load();
        return () => { live = false; generation++; userOff(); brandOff(); };
    }, [api]);
    return answer?.api === api && answer.scope === publishScope() ? answer.role : null;
}
