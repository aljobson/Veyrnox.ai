import { useGlobalSearchParams, usePathname, useRouter, useSegments } from 'expo-router';
import { directionReconciler, languageReturnPath, reconcileLanguageDirection } from '../lib/languageDirection';
import { useEffect, useState, type ReactNode } from 'react';
import { ACTIVE_LOCALES, type LocaleCode } from '../lib/i18n';
import { useAuth } from '../auth/AuthProvider';
import { needsLanguageChoice } from '../lib/languageTransition';
import { readLanguage, syncPendingAccountLanguage } from '../lib/languageStore';
import { LanguageChoice } from './LanguageChoice';

export function LanguageGate({ children, active = ACTIVE_LOCALES }: { children: ReactNode; active?: readonly LocaleCode[] }) {
    const { status, api, canReloadSession } = useAuth();
    const pathname = usePathname();
    const router = useRouter();
    const returnPath = languageReturnPath(pathname, useGlobalSearchParams(), useSegments());
    const [, refreshChoice] = useState(0);
    const stored = readLanguage();
    useEffect(() => {
        if (status === 'loading') return;
        let live = true;
        void reconcileLanguageDirection(returnPath, { signedIn: status === 'signedIn', canReloadSession }).then(ok => {
            if (!live) return;
            const next = directionReconciler.takeReturnPath();
            if (next && next !== returnPath) router.replace(next as never);
            if (ok && !directionReconciler.handledRepair() && status === 'signedIn') void syncPendingAccountLanguage(api, active);
        });
        return () => { live = false; };
    }, [status, api, stored, active, canReloadSession, returnPath, router]);
    if (status === 'signedOut' && needsLanguageChoice(stored, active)) return <LanguageChoice active={active} returnPath="/sign-in" onComplete={() => refreshChoice(value => value + 1)} />;
    return children;
}
