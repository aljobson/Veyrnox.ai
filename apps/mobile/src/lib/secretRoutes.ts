// Listen links are bearer secrets. They may live in the router only, never a reload destination.
export function isListenRoute(path: string): boolean {
    const plain = path.replace(/\/\([^/]+\)/g, '');
    return /^\/(?:music\/)?listen(?:\/|[?#]|$)/i.test(plain);
}
export const safeReturnPath = (path: string): string => isListenRoute(path) ? '/' : path;
