type RouterActions = {
    replace: (...args: never[]) => unknown;
    push: (...args: never[]) => unknown;
};

export function restoreReturnRoute(router: RouterActions, next: string): void {
    const replace = router.replace as unknown as (href: string) => void;
    const push = router.push as unknown as (href: string, options?: { withAnchor?: boolean }) => void;
    const firstSegment = next.split(/[/?#]/)[1];
    if (next.split(/[?#]/)[0] === '/' || ['sign-in', 'email', 'passkey', 'preview', 'review', 'editorial'].includes(firstSegment)) {
        replace(next);
    } else {
        // The app navigator may not be mounted yet; seed its tabs anchor behind the destination.
        push(next, { withAnchor: true });
    }
}
