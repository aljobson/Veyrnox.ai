import { hardPaywallEnabled } from '../lib/hardPaywall';
import { useFirstRunPending } from '../lib/firstRunPending';
import * as SecureStore from 'expo-secure-store';
import { usePathname, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '../auth/AuthProvider';
import { abortPreparing, getPurchaseSnapshot } from '../billing/storePurchaseStore';
import { getCacheUser, subscribeCacheUser } from '../lib/appCache';
import { LEGAL_LINKS } from '../lib/account';
import { paywallReason, type PaywallReason } from '../lib/paywallPrompt';
import { useBalance } from '../lib/useBalance';
import { PaywallSheet } from './paywall/PaywallSheet';

const seenKey = (owner: string) => `veyrnox.paywall.seen.${owner}`;
const depletedKey = (owner: string) => `veyrnox.paywall.depleted.${owner}`;
// Survives prompt remounts, but never a sign-out, owner switch or new session generation.
let promptSession: { owner: string; generation: number; closed: boolean } | null = null;
subscribeCacheUser(() => { promptSession = null; });

export function PaywallPrompt() {
    const firstRunPending = useFirstRunPending();
    const { generation } = useAuth();
    const [owner, setOwner] = useState(getCacheUser());
    useEffect(() => subscribeCacheUser(() => setOwner(getCacheUser())), []);
    // The hard paywall replaces the dismissible prompt (ADR-0108 amendment 2).
    if (!owner || firstRunPending || hardPaywallEnabled()) return null;
    if (!promptSession || promptSession.owner !== owner || promptSession.generation !== generation) {
        promptSession = { owner, generation, closed: false };
    }
    return <AccountPaywall key={`${owner}:${generation}`} owner={owner} session={promptSession} />;
}

function AccountPaywall({ owner, session }: { owner: string; session: NonNullable<typeof promptSession> }) {
    const { api } = useAuth();
    const balance = useBalance();
    const pathname = usePathname();
    const router = useRouter();
    const [accountReady, setAccountReady] = useState(false);
    const [createdAt, setCreatedAt] = useState<string | null>(null);
    const [seenFirst, setSeenFirst] = useState(false);
    const [seenDepleted, setSeenDepleted] = useState(false);
    const [openReason, setOpenReason] = useState<PaywallReason | null>(null);
    const [suspendedForLegal, setSuspendedForLegal] = useState(false);
    const enteredLegal = useRef(false);
    const shownThisSession = useRef(false);
    const close = useCallback(() => {
        const operation = getPurchaseSnapshot();
        if (operation.phase === 'store') return false;
        abortPreparing(operation.opId);
        session.closed = true;
        setOpenReason(null);
        return true;
    }, [session]);

    useEffect(() => {
        if (!openReason) return;
        return () => { session.closed = true; };
    }, [openReason, session]);

    useEffect(() => {
        let live = true;
        void Promise.all([
            SecureStore.getItemAsync(seenKey(owner)).catch(() => null),
            SecureStore.getItemAsync(depletedKey(owner)).catch(() => null),
            api.request<{ created_at?: unknown }>('/api/v1/account').catch(() => null),
        ]).then(([seen, depleted, account]) => {
            if (!live || owner !== getCacheUser()) return;
            setSeenFirst(seen === '1'); setSeenDepleted(depleted === '1');
            setCreatedAt(typeof account?.created_at === 'string' ? account.created_at : null);
            setAccountReady(true);
        });
        return () => { live = false; };
    }, [api, owner]);

    const promptRoute = pathname === '/welcome' || pathname?.startsWith('/credits') || pathname?.startsWith('/legal/');
    useEffect(() => {
        if (pathname?.startsWith('/legal/')) enteredLegal.current = true;
        else if (enteredLegal.current) { enteredLegal.current = false; setSuspendedForLegal(false); }
        if (promptRoute && openReason) close();
    }, [pathname, promptRoute, openReason, close]);
    // A positive balance starts a new depleted cycle even while success is still visible.
    useEffect(() => {
        if (!accountReady || !Number.isFinite(balance) || (balance as number) <= 0 || !seenDepleted) return;
        let live = true;
        void SecureStore.deleteItemAsync(depletedKey(owner)).catch(() => undefined)
            .then(() => { if (live && owner === getCacheUser()) setSeenDepleted(false); });
        return () => { live = false; };
    }, [accountReady, balance, seenDepleted, owner]);
    useEffect(() => {
        if (!accountReady || promptRoute || suspendedForLegal || !Number.isFinite(balance) || openReason) return;
        const reason = paywallReason({ credits: balance, createdAt, seenFirst,
            shownThisSession: shownThisSession.current || session.closed, shownDepletedBalance: seenDepleted });
        if (!reason) return;
        if (reason === 'depleted') {
            setSeenDepleted(true);
            void SecureStore.setItemAsync(depletedKey(owner), '1').catch(() => undefined);
        } else shownThisSession.current = true;
        if (reason === 'first') {
            setSeenFirst(true);
            void SecureStore.setItemAsync(seenKey(owner), '1').catch(() => undefined);
        }
        setOpenReason(reason);
    }, [accountReady, balance, createdAt, openReason, owner, promptRoute, suspendedForLegal, seenDepleted, seenFirst, session]);

    if (!openReason) return null;
    return <PaywallSheet reason={openReason} onClose={close}
        onOptions={() => { if (close()) router.push('/credits'); }}
        onLegal={index => {
            if (!close()) return;
            setSuspendedForLegal(true);
            router.push(LEGAL_LINKS[index].route);
        }} />;
}
