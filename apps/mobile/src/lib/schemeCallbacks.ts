import { AUTH_REDIRECT_URL } from './config';
import { RETURN_URL } from './publishConnect';

// The two addresses on the app's own scheme that end a browser session: Google / Apple sign-in and the Publish
// connect. On iOS the system authentication session swallows them. Android has no such session, so the same address
// also reaches the app as an ordinary link, and there is no screen at auth/callback or social/callback to open.
const CALLBACKS: readonly string[] = [AUTH_REDIRECT_URL, RETURN_URL];

/** Whether a link is exactly one of those two addresses (a query or fragment aside). */
export function isSchemeCallback(link: string): boolean {
    const address = link.split(/[?#]/, 1)[0];
    return CALLBACKS.includes(address);
}
