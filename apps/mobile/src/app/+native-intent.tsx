import { resolveAppLink } from '../lib/resolveAppLink';
import { rememberReferralFromLink } from '../lib/referralCapture';
import { rememberPendingLink } from '../lib/pendingLink';
import { isSchemeCallback } from '../lib/schemeCallbacks';

// A link opened while signed out lands on sign-in; this keeps where it was going (pendingLink.ts). Never throws.
function remembered(route: string): string {
    rememberPendingLink(route);
    return route;
}

// Expo Router calls this for every link the system hands the app (cold start and while open).
// It must never throw: a bad link falls back to Home.
export function redirectSystemPath({ path, initial }: { path: string; initial: boolean }): string | null | Promise<string | null> {
    // The sign-in and Publish connect callbacks (Android): the flow that opened the browser reads the address through
    // its own listener. There is no screen for it, so while the app is open nothing is navigated (Expo Router skips an
    // empty result) and on a cold start the app opens at the root.
    try { if (isSchemeCallback(path)) return initial ? '/' : null; } catch { return initial ? '/' : null; }
    try { rememberReferralFromLink(path); } catch { /* a friend's code is a nicety: never block the link */ }
    try {
        const route = resolveAppLink(path);
        return typeof route === 'string' ? remembered(route) : route.then(remembered, () => '/');
    } catch {
        return '/';
    }
}
