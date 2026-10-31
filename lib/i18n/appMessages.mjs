// App catalogs live in static assets in the Worker and source modules in Node.
import { isLocale } from './locales.mjs';
import { createAssetCatalogLoader } from './assetCatalog.mjs';

const loadCatalog = createAssetCatalogLoader('app');

export async function appMessagesFor(locale) {
  const code = isLocale(locale) ? locale : 'en';
  const [english, selected] = await Promise.all([loadCatalog('en'), loadCatalog(code)]);
  return { ...english, ...selected };
}
