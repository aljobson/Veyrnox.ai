import { getCloudflareContext } from '@opennextjs/cloudflare';

/**
 * The Worker's waitUntil for the request being handled, or null where there is no Worker (next dev, unit tests).
 * Work handed to it is finished after the response has ended or the reader has gone, within the platform's limit.
 *
 * @param {() => {ctx?: {waitUntil?: (work: Promise<unknown>) => void}}} [context]
 * @returns {((work: Promise<unknown>) => void) | null}
 */
export function requestWaitUntil(context = getCloudflareContext) {
    let ctx;
    try { ({ ctx } = context()); } catch { return null; }
    // Called on the context itself: a detached waitUntil is refused by the Worker ("Illegal invocation").
    return ctx && typeof ctx.waitUntil === 'function' ? (work) => ctx.waitUntil(work) : null;
}
