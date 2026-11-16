// Which creation stands for a saved editor project in a list: the first picture or clip on its
// timeline, then any other media. Returns a job id, or null for an empty project.
const MEDIA_ID = /^j-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?:--[a-z]+)?$/;
const ORDER = ['video', 'image', 'overlay', 'audio'];
const MAX_NODES = 2000;

function firstMediaId(node: unknown, budget: { left: number }): string | null {
    const stack: unknown[] = [node];
    while (stack.length && budget.left-- > 0) {
        const value = stack.shift();
        if (Array.isArray(value)) { stack.unshift(...value); continue; }
        if (!value || typeof value !== 'object') continue;
        const record = value as Record<string, unknown>;
        if (typeof record.mediaId === 'string') {
            const match = MEDIA_ID.exec(record.mediaId);
            if (match) return match[1];
        }
        stack.unshift(...Object.values(record));
    }
    return null;
}

export function coverJobId(document: unknown): string | null {
    const timeline = document && typeof document === 'object' ? (document as { timeline?: unknown }).timeline : null;
    if (!timeline || typeof timeline !== 'object') return null;
    const groups = timeline as Record<string, unknown>;
    const budget = { left: MAX_NODES };
    const keys = [...ORDER.filter(key => key in groups), ...Object.keys(groups).filter(key => !ORDER.includes(key))];
    for (const key of keys) {
        const found = firstMediaId(groups[key], budget);
        if (found) return found;
    }
    return null;
}
