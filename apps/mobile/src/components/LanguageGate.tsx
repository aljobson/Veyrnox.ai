import { useEffect, useState, type ReactNode } from 'react';
import { ACTIVE_LOCALES, type LocaleCode } from '../lib/i18n';
import { useAuth } from '../auth/AuthProvider';
import { needsLanguageChoice } from '../lib/languageTransition';
import { readLanguage, syncPendingAccountLanguage } from '../lib/languageStore';
import { LanguageChoice } from './LanguageChoice';

export function LanguageGate({ children, active = ACTIVE_LOCALES }: { children: ReactNode; active?: readonly LocaleCode[] }) {
    const { status, api } = useAuth();
    const [, refreshChoice] = useState(0);
    const stored = readLanguage();
    useEffect(() => {
        if (status === 'signedIn') void syncPendingAccountLanguage(api, active);
    }, [status, api, stored, active]);
    if (status === 'signedOut' && needsLanguageChoice(stored, active)) return <LanguageChoice active={active} returnPath="/sign-in" onComplete={() => refreshChoice(value => value + 1)} />;
    return children;
}
