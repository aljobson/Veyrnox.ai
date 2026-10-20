import { API_BASE } from './api';

// A private link the server made (an approval review link, a team invitation) is shared only when it points at the same
// origin the phone just talked to, over https, on the expected path. The server builds these links from the request
// origin, so that origin is the app's own API base. Anything else is dropped rather than shared: a link on another host,
// a lookalike (the real host with a suffix, or the real name only as userinfo), or a different path.
export function isLinkOnOrigin(url: unknown, pathPrefix: string, base: string = API_BASE): url is string {
    if (typeof url !== 'string' || url.length > 2000) return false;
    try {
        const u = new URL(url);
        const b = new URL(base);
        return u.protocol === 'https:' && u.username === '' && u.password === '' && u.origin === b.origin && u.pathname.startsWith(pathPrefix);
    } catch {
        return false;
    }
}
