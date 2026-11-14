import { useCallback, useState } from 'react';
import { useRouter } from 'expo-router';
import { useHandoffScope } from '../../lib/useHandoffScope';
import type { createHandoff } from '../../lib/createHandoff';
import type { CatalogModel } from '../../lib/media';

type Route = ReturnType<typeof createHandoff>;

// "Change model" on the Create form: picking another model reopens the form on it, carrying the words, settings and
// files typed or added so far. The draft is saved first, and a blur or account change in between cancels the switch.
export function useModelSwitch(flush: () => Promise<void>) {
    const router = useRouter();
    const beginHandoff = useHandoffScope();
    const [picking, setPicking] = useState(false);
    const open = useCallback(() => setPicking(true), []);
    const close = useCallback(() => setPicking(false), []);
    const change = useCallback(async (current: CatalogModel, target: CatalogModel | undefined, route: (target: CatalogModel) => Route) => {
        setPicking(false);
        if (!target || target.id === current.id) return;
        const valid = beginHandoff();
        await flush();
        if (valid()) router.replace(route(target));
    }, [beginHandoff, flush, router]);
    return { picking, open, close, change };
}
