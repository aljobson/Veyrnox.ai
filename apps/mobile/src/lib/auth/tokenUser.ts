export function tokenUser(accessToken: string): string | null {
    const part = accessToken.split('.')[1];
    if (!part) return null;
    try {
        const json = atob(part.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(part.length / 4) * 4, '='));
        const sub = (JSON.parse(json) as { sub?: unknown }).sub;
        return typeof sub === 'string' && sub ? sub : null;
    } catch {
        return null;
    }
}

export function isAccountChanged(err: unknown): boolean {
    return typeof err === 'object' && err !== null &&
        'status' in err && err.status === 401 && 'code' in err && err.code === 'account_changed';
}
