export function restoreReturnRoute(router: {
    replace(href: string): void;
    push(href: string, options?: { withAnchor?: boolean }): void;
}, next: string): void {
    const firstSegment = next.split(/[/?#]/)[1];
    if (next.split(/[?#]/)[0] === '/' || ['sign-in', 'email', 'passkey', 'preview', 'review', 'editorial'].includes(firstSegment)) {
        router.replace(next);
    } else {
        // The app navigator may not be mounted yet; seed its tabs anchor behind the destination.
        router.push(next, { withAnchor: true });
    }
}
