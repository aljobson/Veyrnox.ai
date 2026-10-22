import { Directory, File, Paths } from 'expo-file-system';
import { MOTIONS, sanitizePicks, type Picks } from './oddlingsBuilder';

export const PASSPORT_LIMIT = 24;
const VERSION = 1;

export interface Passport { readonly id: string; readonly savedAt: number; readonly name: string; readonly picks: Picks; readonly motionId: string }
export interface Draft { readonly savedAt: number; readonly picks: Picks }
export interface PassportDoc { readonly items: readonly Passport[]; readonly draft: Draft | null }
export interface DocStore { read(): Promise<string | null>; write(text: string): Promise<void> }

const EMPTY: PassportDoc = { items: [], draft: null };

export function cleanItem(raw: unknown): Passport | null {
    if (!raw || typeof raw !== 'object') return null;
    const item = raw as Record<string, unknown>;
    const number = Number(item.savedAt);
    const savedAt = Math.min(1e14, Math.max(0, Math.trunc(number)));
    if (!Number.isFinite(number)) return null;
    const picks = sanitizePicks(item.picks);
    return {
        id: (String(item.id || '').replace(/[^A-Za-z0-9._-]/g, '-').slice(0, 80) || `oddling-${savedAt}`),
        savedAt,
        name: picks.oddling_name || 'Untitled Oddling',
        picks,
        motionId: MOTIONS.some((m) => m.id === item.motionId) ? (item.motionId as string) : '',
    };
}

export function parseDoc(text: string | null): PassportDoc {
    try {
        const parsed = JSON.parse(text ?? '') as { version?: number; items?: unknown; draft?: { savedAt?: unknown; picks?: unknown } | null };
        if (!parsed || parsed.version !== VERSION) return EMPTY;
        const items = (Array.isArray(parsed.items) ? parsed.items : []).map(cleanItem).filter((i): i is Passport => i !== null).sort((a, b) => b.savedAt - a.savedAt);
        const seen = new Set<string>();
        items.forEach((item, index) => {
            let id = item.id, counter = 1;
            while (seen.has(id)) { const suffix = `-${counter++}`; id = item.id.slice(0, 80 - suffix.length) + suffix; }
            seen.add(id); items[index] = { ...item, id };
        });
        const draftAt = Number(parsed.draft?.savedAt);
        const draft = parsed.draft && Number.isFinite(draftAt) ? { savedAt: Math.min(1e14, Math.max(0, Math.trunc(draftAt))), picks: sanitizePicks(parsed.draft.picks) } : null;
        return { items, draft };
    } catch {
        return EMPTY;
    }
}

const serialize = (doc: PassportDoc): string => JSON.stringify({ version: VERSION, items: doc.items, draft: doc.draft });

// Retired document helpers: kept only for the legacy file reader and tests; screens use oddlingsAccountStore.
export async function loadDoc(store: DocStore): Promise<PassportDoc> {
    try {
        return parseDoc(await store.read());
    } catch {
        return EMPTY;
    }
}

// Saving twice for the same loaded passport updates it instead of adding a copy.
export async function savePassport(store: DocStore, picks: Picks, now: number, existingId?: string | null, motionId = ''): Promise<{ ok: boolean; doc: PassportDoc; item: Passport | null }> {
    const doc = await loadDoc(store);
    const clean = sanitizePicks(picks);
    const item = cleanItem({ id: existingId && doc.items.some((i) => i.id === existingId) ? existingId : `oddling-${now}-${Math.random().toString(36).slice(2, 8)}`, savedAt: now, picks: clean, motionId });
    if (!item || (doc.items.length >= PASSPORT_LIMIT && !doc.items.some(i => i.id === item.id))) return { ok: false, doc, item: null };
    const next: PassportDoc = { items: [item, ...doc.items.filter((i) => i.id !== item.id)], draft: { savedAt: now, picks: clean } };
    try {
        await store.write(serialize(next));
        return { ok: true, doc: next, item };
    } catch {
        return { ok: false, doc, item: null };
    }
}

export async function removePassport(store: DocStore, id: string): Promise<PassportDoc> {
    const doc = await loadDoc(store);
    const next = { ...doc, items: doc.items.filter((i) => i.id !== id) };
    try {
        await store.write(serialize(next));
        return next;
    } catch {
        return doc;
    }
}

export async function saveDraft(store: DocStore, picks: Picks, now: number): Promise<void> {
    const doc = await loadDoc(store);
    try {
        await store.write(serialize({ ...doc, draft: { savedAt: now, picks: sanitizePicks(picks) } }));
    } catch {
        // A draft that cannot be kept costs nothing but the next launch's head start.
    }
}

// Only claimLegacyOddlings may read this retired install-wide file. Never write it again.
export const legacyFileStore = {
    exists() { return new File(new Directory(Paths.document, 'veyrnox-oddlings'), 'passports.json').exists; },
    async read() {
        const file = new File(new Directory(Paths.document, 'veyrnox-oddlings'), 'passports.json');
        return file.exists ? file.text() : null;
    },
    async remove() {
        const file = new File(new Directory(Paths.document, 'veyrnox-oddlings'), 'passports.json');
        if (file.exists) file.delete();
    },
};
