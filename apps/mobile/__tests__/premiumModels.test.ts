import { fetchAllCatalog, type CatalogModel } from '../src/lib/media';
import { fetchPremiumModels } from '../src/lib/premiumModels';
jest.mock('../src/lib/media', () => ({ ...jest.requireActual('../src/lib/media'), fetchAllCatalog: jest.fn() }));
const model: CatalogModel = { id: 'premium', name: 'Premium video', modality: 'text-to-video', credits: 7, durations: [5], gated: true, capabilities: { inputs: { prompt: {} } } };
beforeEach(() => jest.mocked(fetchAllCatalog).mockReset());
test('keeps only strictly gated, drivable models and preserves their catalog values', async () => {
    jest.mocked(fetchAllCatalog).mockResolvedValue([
        model, { ...model, id: 'open', gated: false },
        { ...model, id: 'no-input', capabilities: {} },
        { ...model, id: 'unknown-slot', capabilities: { media: { mesh: { required: true } } } },
        { ...model, id: 'unknown-kind', modality: 'mesh' },
    ]);
    expect(await fetchPremiumModels()).toEqual([model]);
    expect(model.gated).toBe(true);
});
test('fetches live each time without caching', async () => {
    jest.mocked(fetchAllCatalog).mockResolvedValueOnce([model]).mockResolvedValueOnce([]);
    expect(await fetchPremiumModels()).toEqual([model]);
    expect(await fetchPremiumModels()).toEqual([]);
    expect(fetchAllCatalog).toHaveBeenCalledTimes(2);
});
test('a catalog failure returns an empty premium list', async () => {
    jest.mocked(fetchAllCatalog).mockRejectedValue(Error('offline'));
    expect(await fetchPremiumModels()).toEqual([]);
});
