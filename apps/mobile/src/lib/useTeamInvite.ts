import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { ApiClient } from './api';
import { t } from './i18n';
import { brandStore } from './publishBrand';
import { acceptInvite, fetchInvite, inviteErrorKey, validToken, type Invite } from './shareLinks';

interface State {
    token: string;
    scope: object;
    invite: Invite | null;
    error: string | null;
    phase: 'idle' | 'loading' | 'ready' | 'accepting' | 'joined';
    idempotent: boolean;
}

const initial = (token: string): State => ({ token, scope: {}, invite: null, error: null, phase: validToken(token) ? 'loading' : 'idle', idempotent: false });

export function useTeamInvite(api: Pick<ApiClient, 'request'>, token: string) {
    let [state, setState] = useState(() => initial(token));
    if (state.token !== token) {
        state = initial(token);
        setState(state);
    }
    const { scope } = state;
    const current = useRef<object | null>(null);
    const accepting = useRef<object | null>(null);
    useLayoutEffect(() => {
        current.current = scope;
        return () => { current.current = null; };
    }, [scope]);

    useEffect(() => {
        if (!validToken(token)) return;
        let live = true;
        fetchInvite(token).then(
            (invite) => {
                if (live && current.current === scope) setState((s) => ({ ...s, invite, phase: 'ready' }));
            },
            (err) => {
                if (live && current.current === scope) setState((s) => ({ ...s, error: t(inviteErrorKey(err)), phase: 'idle' }));
            },
        );
        return () => { live = false; };
    }, [token, scope]);

    async function accept() {
        if (state.phase !== 'ready' || current.current !== scope || accepting.current === scope) return;
        accepting.current = scope;
        setState((s) => ({ ...s, error: null, phase: 'accepting' }));
        try {
            const out = await acceptInvite(api, token);
            if (current.current !== scope) return;
            if (out.brandId) brandStore.set(out.brandId);
            setState((s) => ({ ...s, phase: 'joined', idempotent: out.idempotent }));
        } catch (err) {
            if (current.current !== scope) return;
            setState((s) => ({ ...s, phase: 'ready', error: t(inviteErrorKey(err), { email: s.invite?.email ?? '' }) }));
        } finally {
            if (accepting.current === scope) accepting.current = null;
        }
    }

    return { invite: state.invite, error: state.error, phase: state.phase, idempotent: state.idempotent, accept };
}
