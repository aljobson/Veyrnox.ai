// What leaves the device in a crash report. Reports must carry no account data: no user, no request
// bodies or headers, no error message a person typed, and no URL query or fragment (an OAuth return
// URL carries a one-time code). This mirrors the web bar in lib/sentryScrub.js.

export function scrubUrl(url: string): string {
    const cut = url.search(/[?#]/);
    const bare = cut === -1 ? url : url.slice(0, cut);
    return bare.replace(/^((?:[a-z][a-z0-9+.-]*:\/\/[^/]+)?\/(?:api\/social\/team|social\/team\/invite|api\/social\/approvals|social\/review|media\/social)\/)[^/]+/i, '$1:token');
}

type Bag = Record<string, unknown>;

const URL_KEYS = ['url', 'from', 'to'];
const LOOKS_LIKE_URL = /^https?:|^[a-z0-9.]+:\/\//i;
// A constant stands in for the thrown message, which can hold a prompt, an email or provider output.
const EXCEPTION_VALUE = 'Mobile request failed';
// Source locations that echo the surrounding code and locals; keep only the frame's position.
const FRAME_CONTEXT_KEYS = ['context_line', 'pre_context', 'post_context', 'vars'];
// Contexts set by us or the SDK that carry no header or body; anything else is dropped.
const SAFE_CONTEXTS = ['trace', 'runtime', 'device', 'app', 'os'];

export function scrubBreadcrumb<T extends object>(crumb: T): T {
    const out: Bag = { ...(crumb as Bag) };
    // Console breadcrumbs repeat whatever was logged, so only the envelope survives.
    if (out.category === 'console') {
        const envelope: Bag = { category: 'console', level: out.level, timestamp: out.timestamp };
        return envelope as T;
    }
    const data = out.data;
    if (data && typeof data === 'object') {
        const clean: Bag = { ...(data as Bag) };
        for (const key of URL_KEYS) if (typeof clean[key] === 'string') clean[key] = scrubUrl(clean[key] as string);
        // Request and response payloads and logged arguments never leave the device.
        delete clean.request_body;
        delete clean.response_body;
        delete clean.arguments;
        out.data = clean;
    }
    // A URL message keeps its route; any other message is dropped (it may repeat what was logged).
    if (typeof out.message === 'string') out.message = LOOKS_LIKE_URL.test(out.message) ? scrubUrl(out.message) : undefined;
    return out as T;
}

export function scrubEvent<T extends object>(event: T): T {
    const out: Bag = { ...(event as Bag) };
    delete out.user;
    delete out.extra;
    delete out.message;
    delete out.logentry;
    const request = out.request as { url?: unknown } | undefined;
    if (request) out.request = typeof request.url === 'string' ? { url: scrubUrl(request.url) } : {};
    const exception = out.exception as { values?: unknown } | undefined;
    if (exception && Array.isArray(exception.values)) {
        out.exception = {
            ...(exception as Bag),
            values: exception.values.map((value) => {
                const v: Bag = { ...(value as Bag) };
                v.value = EXCEPTION_VALUE;
                const stacktrace = v.stacktrace as { frames?: unknown } | undefined;
                if (stacktrace && Array.isArray(stacktrace.frames)) {
                    v.stacktrace = {
                        ...(stacktrace as Bag),
                        frames: stacktrace.frames.map((frame) => {
                            const f: Bag = { ...(frame as Bag) };
                            for (const key of FRAME_CONTEXT_KEYS) delete f[key];
                            return f;
                        }),
                    };
                }
                return v;
            }),
        };
    }
    if (Array.isArray(out.breadcrumbs)) out.breadcrumbs = out.breadcrumbs.map((c: object) => scrubBreadcrumb(c));
    const contexts = out.contexts;
    if (contexts && typeof contexts === 'object') {
        const source = contexts as Bag;
        const pruned: Bag = {};
        for (const key of SAFE_CONTEXTS) if (source[key] !== undefined) pruned[key] = source[key];
        out.contexts = pruned;
    }
    return out as T;
}
