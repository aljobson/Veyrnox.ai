import { MAX_SAVED_TAKES, addToIndex, parseIndex, removeFromIndex, type SavedTake } from '../src/lib/instrumentTakeIndex';

const OWNER = '11111111-1111-4111-8111-111111111111';
const take = (n: number): SavedTake => ({ id: `take-000${n}-aaaa`, label: `Take ${n}`, name: `take-000${n}-aaaa.wav`, seconds: 1.5, createdAt: 1000 + n });

describe('saved instrument take index', () => {
    test('a missing, corrupt or foreign index is empty', () => {
        expect(parseIndex(null, OWNER).items).toEqual([]);
        expect(parseIndex('{nope', OWNER).items).toEqual([]);
        expect(parseIndex(JSON.stringify({ owner: 'someone-else-0000', items: [take(1)] }), OWNER).items).toEqual([]);
    });

    test('rows with unsafe names, bad numbers or duplicate ids are dropped', () => {
        const raw = JSON.stringify({ owner: OWNER, items: [take(1), take(1), { ...take(2), name: '../escape.wav' }, { ...take(3), seconds: 0 }, { ...take(4), id: 'x' }] });
        expect(parseIndex(raw, OWNER).items.map((item) => item.id)).toEqual([take(1).id]);
    });

    test('newest first, capped, and the overflow is reported so its files can be removed', () => {
        let index = parseIndex(null, OWNER);
        let dropped: SavedTake[] = [];
        for (let n = 0; n < MAX_SAVED_TAKES + 2; n += 1) ({ index, dropped } = addToIndex(index, take(n)));
        expect(index.items).toHaveLength(MAX_SAVED_TAKES);
        expect(index.items[0].id).toBe(take(MAX_SAVED_TAKES + 1).id);
        expect(dropped).toHaveLength(1);
        expect(dropped[0].id).toBe(take(1).id);
    });

    test('remove deletes only the named take', () => {
        const { index } = addToIndex(addToIndex(parseIndex(null, OWNER), take(1)).index, take(2));
        expect(removeFromIndex(index, take(1).id).items.map((item) => item.id)).toEqual([take(2).id]);
    });
});
