// Outside the Worker, the fallback uses Node's module cache plus the per-process Map;
// under next dev, edited app catalogs appear after a dev-server restart.
import { getCloudflareContext } from '@opennextjs/cloudflare';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { isLocale } from './locales.mjs';

// Instantiate once at module scope: concurrent requests share a promise per locale.
export function createAssetCatalogLoader(directory, { context = getCloudflareContext } = {}) {
  const catalogs = new Map();

  async function read(code) {
    let assets;
    try { assets = context()?.env?.ASSETS; } catch { /* No Worker context in Node. */ }
    if (assets) {
      const response = await assets.fetch(`https://assets.local/_i18n/${directory}/${code}.json`);
      if (!response.ok) throw new Error(`Catalog ${directory}/${code}: assets returned ${response.status}`);
      return JSON.parse(await response.text());
    }
    // The generated Next chunk lives under .next; resolve from the project root.
    const source = pathToFileURL(join(process.cwd(), 'lib/i18n/messages', directory, `${code}.mjs`)).href;
    return (await import(/* webpackIgnore: true */ /* turbopackIgnore: true */ source)).default;
  }

  return function loadCatalog(locale) {
    const code = isLocale(locale) ? locale : 'en';
    if (!catalogs.has(code)) {
      const pending = read(code).catch((error) => {
        catalogs.delete(code);
        throw error;
      });
      catalogs.set(code, pending);
    }
    return catalogs.get(code);
  };
}
