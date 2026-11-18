// Attempt URLs are file leases on mobile. A retry acquires before either attempt can release.
export function createFileLeases(remove: (uri: string) => void) {
    const entries = new Map<string, { account: string; count: number }>();
    return {
        acquire(account: string, uri: string) {
            const existing = entries.get(uri);
            if (existing && existing.account !== account) throw Error('account_changed');
            entries.set(uri, { account, count: (existing?.count ?? 0) + 1 });
            return uri;
        },
        release(uri: string) {
            const entry = entries.get(uri);
            if (!entry) return;
            if (--entry.count === 0) { entries.delete(uri); remove(uri); }
        },
        purge(account: string) {
            for (const [uri, entry] of entries) if (entry.account === account) { entries.delete(uri); remove(uri); }
        },
    };
}
