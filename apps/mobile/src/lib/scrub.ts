// What leaves the device in a crash report. Reports must carry no account data: no user, no request
// bodies or headers, and no URL query or fragment (an OAuth return URL carries a one-time code).

export function scrubUrl(url: string): string {
    const cut = url.search(/[?#]/);
    const bare = cut === -1 ? url : url.slice(0, cut);
    return bare.replace(/^((?:[a-z][a-z0-9+.-]*:\/\/[^/]+)?\/(?:api\/social\/team|social\/team\/invite|api\/social\/approvals|social\/review)\/)[^/]+/i, '$1:token');
}

type Bag = Record<string, unknown>;

const URL_KEYS = ['url', 'from', 'to'];
const LOOKS_LIKE_URL = /^https?:|^[a-z0-9.]+:\/\//i;

export function scrubBreadcrumb<T extends object>(crumb: T): T {
    const out: Bag = { ...(crumb as Bag) };
    const data = out.data;
    if (data && typeof data === 'object') {
        const clean: Bag = { ...(data as Bag) };
        for (const key of URL_KEYS) if (typeof clean[key] === 'string') clean[key] = scrubUrl(clean[key] as string);
        // Request and response payloads never leave the device.
        delete clean.request_body;
        delete clean.response_body;
        out.data = clean;
    }
    if (typeof out.message === 'string' && LOOKS_LIKE_URL.test(out.message)) out.message = scrubUrl(out.message);
    return out as T;
}

export function scrubEvent<T extends object>(event: T): T {
    const out: Bag = { ...(event as Bag) };
    delete out.user;
    delete out.extra;
    const request = out.request as { url?: unknown } | undefined;
    if (request) out.request = typeof request.url === 'string' ? { url: scrubUrl(request.url) } : {};
    if (Array.isArray(out.breadcrumbs)) out.breadcrumbs = out.breadcrumbs.map((c: object) => scrubBreadcrumb(c));
    return out as T;
}
