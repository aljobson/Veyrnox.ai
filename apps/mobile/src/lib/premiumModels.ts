import { fetchAllCatalog, isSupported, type CatalogModel } from './media';

// Premium discovery is live and optional; an outage must not hide the open catalog.
export async function fetchPremiumModels(): Promise<CatalogModel[]> {
    try {
        return (await fetchAllCatalog()).filter(model => model.gated === true && isSupported({ ...model, gated: false }));
    } catch { return []; }
}
