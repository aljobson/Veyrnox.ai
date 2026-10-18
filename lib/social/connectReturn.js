// Where a provider sends the browser after consent (ADR-0135). The web flow
// returns to a page on our origin (`/social/connect/callback/<network>`); the
// mobile app, which has no web session, returns to a bridge on the same origin
// that hands the one-time code to the app's fixed scheme. Both are constants
// built here from the network key and a two-value enum, never from user input.
// The connect and callback routes must pick the same path for one attempt: the
// provider checks the token request's redirect_uri against the authorize one.

export const APP_CONNECT_CALLBACK = 'ai.veyrnox.app://social/callback';

/** Reads the optional body `client`. Absent means web; anything but the two
 * known values is refused (null) so a typo never silently falls back. */
export function requestedClient(body) {
    const client = body && typeof body === 'object' ? body.client : undefined;
    if (client === undefined) return 'web';
    return client === 'web' || client === 'mobile' ? client : null;
}

export function connectCallbackPath(network, client) {
    return `/social/connect/${client === 'mobile' ? 'mobile' : 'callback'}/${network}`;
}
