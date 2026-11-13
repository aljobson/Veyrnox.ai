// ADR-0338 S2b: Permissions-Policy belongs to the DOCUMENT that was loaded, not to a client-side route. A document loaded at
// Photo Studio keeps camera=(self) after a soft (next/link) navigation to another page, which would hand the camera to a
// route that is not meant to have it. So every way out of Photo Studio becomes a full document navigation, and the next
// page is served with its own header. (Nothing links INTO Photo Studio; a future link must be a plain <a href>.)
export const inPhotoStudio = pathname => /^\/(?:veyrnox\/)?app\/photo-studio(?:\/|$)/.test(pathname);

export function leavesPhotoStudio(href, base) {
    try {
        const target = new URL(href, base), here = new URL(base);
        return target.origin === here.origin && !inPhotoStudio(target.pathname);
    } catch { return false; }
}

/** Returns a disposer. Capture-phase, so it runs before the framework's own link handler. */
export function installHardNavigation({ doc = globalThis.document, win = globalThis.window } = {}) {
    const click = event => {
        if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        const link = typeof event.target?.closest === 'function' ? event.target.closest('a[href]') : null;
        if (!link || typeof link.href !== 'string' || (link.target && link.target !== '_self') || link.hasAttribute?.('download')) return; // an SVG <a> has an object href
        if (!leavesPhotoStudio(link.href, win.location.href)) return;
        event.preventDefault(); event.stopImmediatePropagation?.();
        win.location.assign(link.href);
    };
    // Back/forward inside the single-page app changes the URL without loading a new document.
    const pop = () => { if (!inPhotoStudio(win.location.pathname)) win.location.reload(); };
    doc.addEventListener('click', click, { capture: true }); win.addEventListener('popstate', pop);
    return () => { doc.removeEventListener('click', click, { capture: true }); win.removeEventListener('popstate', pop); };
}

/**
 * Catch-all for exits that are not link clicks (router.push, redirect). When Photo Studio unmounts and the URL is already
 * outside it, the document still carries camera=(self): load the destination as a real document instead.
 */
export function reloadIfLeft(win = globalThis.window) { if (!inPhotoStudio(win.location.pathname)) win.location.reload(); }
