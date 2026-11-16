import { templatesWithCatalogModel } from '../src/lib/exploreTemplates';
import type { CatalogModel } from '../src/lib/media';

const models = new Map([['a', { id: 'a' } as CatalogModel]]);
const list = [{ modelId: 'a', n: 1 }, { modelId: 'gone', n: 2 }, { modelId: 'a', n: 3 }];

test('an unknown catalog (null) hides nothing', () => {
    expect(templatesWithCatalogModel(list, null)).toEqual(list);
});
test('a loaded catalog keeps only templates whose model it lists, in order', () => {
    expect(templatesWithCatalogModel(list, models).map(i => i.n)).toEqual([1, 3]);
});
test('a loaded empty catalog hides everything', () => {
    expect(templatesWithCatalogModel(list, new Map())).toEqual([]);
});
