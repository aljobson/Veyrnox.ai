import { PASSPORT_LIMIT, loadDoc, parseDoc, removePassport, saveDraft, savePassport, type DocStore } from '../src/lib/oddlingsLibrary';

const memory = (initial: string | null = null): DocStore & { text: string | null } => {
    const store = { text: initial, read: async () => store.text, write: async (t: string) => { store.text = t; } };
    return store;
};

describe('saved passports', () => {
    test('save, reload and remove', async () => {
        const store = memory();
        const saved = await savePassport(store, { character_type: 'Human', oddling_name: 'Ada' }, 1000);
        expect(saved.ok).toBe(true);
        expect((await loadDoc(store)).items.map((i) => i.name)).toEqual(['Ada']);
        const after = await removePassport(store, saved.item!.id);
        expect(after.items).toEqual([]);
    });

    test('saving a loaded passport again updates it', async () => {
        const store = memory();
        const first = await savePassport(store, { oddling_name: 'Ada' }, 1000);
        await savePassport(store, { oddling_name: 'Ada B' }, 2000, first.item!.id);
        const doc = await loadDoc(store);
        expect(doc.items).toHaveLength(1);
        expect(doc.items[0].name).toBe('Ada B');
    });

    test('newest first, a new item at the limit is refused without dropping anything', async () => {
        const store = memory();
        for (let i = 0; i < PASSPORT_LIMIT + 3; i += 1) {
            const saved = await savePassport(store, { oddling_name: `N${i}` }, 1000 + i);
            if (i === PASSPORT_LIMIT) expect(saved).toMatchObject({ ok: false, item: null });
        }
        const { items } = await loadDoc(store);
        expect(items).toHaveLength(PASSPORT_LIMIT);
        expect(items[0].name).toBe(`N${PASSPORT_LIMIT - 1}`);
    });

    test('a damaged or foreign file reads as empty, and picks are cleaned on the way in', () => {
        expect(parseDoc('not json')).toEqual({ items: [], draft: null });
        expect(parseDoc(JSON.stringify({ version: 2, items: [] }))).toEqual({ items: [], draft: null });
        const doc = parseDoc(JSON.stringify({ version: 1, items: [{ id: 'a', savedAt: 5, picks: { character_type: 'Nope', oddling_name: 'X' } }, { savedAt: 'bad' }], draft: null }));
        expect(doc.items).toHaveLength(1);
        expect(doc.items[0].picks).toEqual({ oddling_name: 'X' });
    });

    test('a write that fails reports it and keeps the old list', async () => {
        const store = memory();
        await savePassport(store, { oddling_name: 'Keep' }, 1);
        store.write = async () => { throw new Error('disk full'); };
        const result = await savePassport(store, { oddling_name: 'Lost' }, 2);
        expect(result.ok).toBe(false);
        expect(result.doc.items.map((i) => i.name)).toEqual(['Keep']);
    });

    test('the draft is kept next to the passports', async () => {
        const store = memory();
        await savePassport(store, { oddling_name: 'P' }, 1);
        await saveDraft(store, { oddling_name: 'Draft' }, 2);
        const doc = await loadDoc(store);
        expect(doc.draft?.picks.oddling_name).toBe('Draft');
        expect(doc.items).toHaveLength(1);
    });
});

describe('opening move in a passport', () => {
    test('is saved and read back, and an unknown move is dropped', async () => {
        const store = memory();
        await savePassport(store, { oddling_name: 'A' }, 1, null, 'micro-dance');
        expect((await loadDoc(store)).items[0].motionId).toBe('micro-dance');
        await savePassport(store, { oddling_name: 'B' }, 2, null, 'not-a-move');
        expect((await loadDoc(store)).items[0].motionId).toBe('');
    });
});

test('removing a passport preserves the draft', async () => {
    const store = memory(); const result = await savePassport(store, { oddling_name: 'Pip' }, 1);
    const before = await loadDoc(store); await removePassport(store, result.item!.id);
    expect((await loadDoc(store)).draft).toEqual(before.draft);
});
test('repairs bad legacy ids, fractional timestamps and lone surrogates', () => {
    const doc = parseDoc(JSON.stringify({ version: 1, items: [{ id: 'bad/id', savedAt: -2.5, picks: { oddling_name: 'Pip\uD800' } }] }));
    expect(doc.items[0]).toMatchObject({ id: 'bad-id', savedAt: 0, name: 'Pip\uFFFD' });
});
