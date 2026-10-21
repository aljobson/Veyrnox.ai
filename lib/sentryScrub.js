// What leaves the Worker in an error report (ADR-0170). Reports carry stack locations and the
// error's name, and nothing a person typed: error messages can hold provider output or user input,
// and a request can hold tokens, cookies, a prompt or a one-time OAuth code in its query string.
import { scrubTelemetryTree, scrubTelemetryUrl } from './telemetryUrl.js';

const MESSAGE = 'Server request failed';
const URL_KEYS = ['url', 'from', 'to'];
const LOOKS_LIKE_URL = /^https?:|^[a-z0-9.]+:\/\//i;

/** @param {string} url */
export function scrubUrl(url) {
    return scrubTelemetryUrl(url);
}

/** @param {Record<string, any>} crumb */
export function scrubBreadcrumb(crumb) {
    const out = { ...crumb };
    // Console and fetch breadcrumbs repeat whatever was logged, so only the category survives.
    if (out.category === 'console') return { category: 'console', level: out.level, timestamp: out.timestamp };
    if (out.data && typeof out.data === 'object') {
        const data = { ...out.data };
        for (const key of URL_KEYS) if (typeof data[key] === 'string') data[key] = scrubUrl(data[key]);
        delete data.request_body;
        delete data.response_body;
        delete data.arguments;
        out.data = data;
    }
    if (typeof out.message === 'string') out.message = LOOKS_LIKE_URL.test(out.message) ? scrubUrl(out.message) : undefined;
    return scrubTelemetryTree(out);
}

/** @param {Record<string, any>} event */
export function scrubEvent(event) {
    const out = { ...event };
    delete out.user;
    delete out.extra;
    delete out.server_name;
    delete out.message;
    delete out.logentry;
    if (out.request && typeof out.request === 'object') {
        const { method, url } = out.request;
        out.request = {
            ...(typeof method === 'string' ? { method } : {}),
            ...(typeof url === 'string' ? { url: scrubUrl(url) } : {}),
        };
    }
    if (out.exception && Array.isArray(out.exception.values)) {
        out.exception = {
            ...out.exception,
            values: out.exception.values.map((v) => ({
                ...v, value: MESSAGE,
                ...(v.stacktrace ? { stacktrace: { ...v.stacktrace,
                    frames: v.stacktrace.frames?.map(({ context_line, pre_context, post_context, vars, ...frame }) => frame),
                } } : {}),
            })),
        };
    }
    if (Array.isArray(out.breadcrumbs)) out.breadcrumbs = out.breadcrumbs.map(scrubBreadcrumb);
    // Tags and contexts are set by us or by the SDK; drop anything that could echo a header or a body.
    if (out.contexts && typeof out.contexts === 'object') {
        const { trace, runtime, cloud_resource } = out.contexts;
        out.contexts = { ...(trace ? { trace } : {}), ...(runtime ? { runtime } : {}), ...(cloud_resource ? { cloud_resource } : {}) };
    }
    return scrubTelemetryTree(out);
}
