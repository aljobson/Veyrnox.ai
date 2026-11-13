import { useEffect, useState } from 'react';
import { useAuth } from '../auth/AuthProvider';
import { loadFirstAnswers } from './firstProfileStore';
import type { FirstAnswers } from './firstProfile';

// What this person told us in the first-run questions, once known: { ready, goal, role, destination }. Never throws; until
// it is known (or when nothing can be read) every word is null, so a screen shows its default order.
export function useFirstProfile(): FirstAnswers & { readonly ready: boolean } {
    const { api } = useAuth();
    const [state, setState] = useState<FirstAnswers & { ready: boolean }>({ ready: false, goal: null, role: null, destination: null });
    useEffect(() => {
        let alive = true;
        loadFirstAnswers(api).then((answers) => { if (alive) setState({ ready: true, ...answers }); }).catch(() => undefined);
        return () => { alive = false; };
    }, [api]);
    return state;
}
