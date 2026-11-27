import { usePathname, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { completeNotificationPrimer, readNotificationPrimer, subscribeNotificationPrimer } from '../lib/notificationPrimer';
import { usePush } from '../push/pushContext';

const BLOCKED_ROUTES = new Set(['/analytics-consent', '/welcome', '/first-run', '/notification-primer', '/paywall']);

export function NotificationPrimerGate() {
    const router = useRouter();
    const pathname = usePathname();
    const push = usePush();
    const opening = useRef(false);
    const [revision, setRevision] = useState(0);

    useEffect(() => subscribeNotificationPrimer(() => setRevision(value => value + 1)), []);
    useEffect(() => {
        let alive = true;
        let timer: ReturnType<typeof setTimeout> | undefined;
        void readNotificationPrimer().then(state => {
            if (!alive || !state.pending) return;
            if (push.enabled) {
                void completeNotificationPrimer();
                return;
            }
            if (!push.supported || opening.current || BLOCKED_ROUTES.has(pathname) || pathname.startsWith('/legal/')) return;
            // The generation caller normally navigates to its job screen after the request resolves. Let that transition
            // settle, then layer the contextual explanation on top of the job the notification is about.
            timer = setTimeout(() => {
                if (!alive || opening.current) return;
                opening.current = true;
                router.push('/notification-primer');
            }, 750);
        });
        return () => { alive = false; clearTimeout(timer); };
    }, [pathname, push.enabled, push.supported, revision, router]);
    useEffect(() => { if (pathname !== '/notification-primer') opening.current = false; }, [pathname]);
    return null;
}
