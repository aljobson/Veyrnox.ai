// Pure index logic for saved instrument takes (no file system), so it can be tested on its own.
// Only the file NAME is stored: the app container path can change between launches and updates.
export type SavedTake = { id: string; label: string; name: string; seconds: number; createdAt: number };
export type TakeIndex = { owner: string; items: SavedTake[] };

export const MAX_SAVED_TAKES = 12;
const ID = /^[A-Za-z0-9-]{8,64}$/;
const NAME = /^[A-Za-z0-9-]{8,64}\.wav$/;

const clean = (value: unknown): SavedTake | null => {
    if (!value || typeof value !== 'object') return null;
    const row = value as Record<string, unknown>;
    if (typeof row.id !== 'string' || !ID.test(row.id) || typeof row.name !== 'string' || !NAME.test(row.name)) return null;
    const seconds = Number(row.seconds), createdAt = Number(row.createdAt);
    if (!Number.isFinite(seconds) || seconds <= 0 || !Number.isFinite(createdAt) || createdAt <= 0) return null;
    return { id: row.id, label: String(row.label ?? '').slice(0, 80), name: row.name, seconds, createdAt };
};

export function parseIndex(raw: string | null, owner: string): TakeIndex {
    try {
        const value = JSON.parse(raw ?? 'null');
        if (value?.owner === owner && Array.isArray(value.items)) {
            const seen = new Set<string>();
            const items = value.items.map(clean).filter((item: SavedTake | null): item is SavedTake => !!item && !seen.has(item.id) && !!seen.add(item.id));
            return { owner, items: items.sort((a: SavedTake, b: SavedTake) => b.createdAt - a.createdAt).slice(0, MAX_SAVED_TAKES) };
        }
    } catch { /* A missing or corrupt index is an empty one; files are cleaned separately. */ }
    return { owner, items: [] };
}

export function addToIndex(index: TakeIndex, item: SavedTake): { index: TakeIndex; dropped: SavedTake[] } {
    const next = [item, ...index.items.filter((existing) => existing.id !== item.id)];
    return { index: { owner: index.owner, items: next.slice(0, MAX_SAVED_TAKES) }, dropped: next.slice(MAX_SAVED_TAKES) };
}

export const removeFromIndex = (index: TakeIndex, id: string): TakeIndex => ({ owner: index.owner, items: index.items.filter((item) => item.id !== id) });
