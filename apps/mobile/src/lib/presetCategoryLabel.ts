import { t } from './i18n';
const CATEGORIES = new Set(['ALL', 'NEW', 'POPULAR', 'YOUR PHOTO', 'KIDS BIRTHDAY', 'CINEMATIC', 'ANIME', 'CARTOONS', 'MOVIES', 'FANTASY', 'REALISTIC', 'FASHION', 'PRODUCTS', 'VFX', 'UGC', 'ADS']);
// Keep the id for filtering. Unknown server categories never become visible copy.
export const categoryLabel = (id: string): string => t(CATEGORIES.has(id) ? `presets.cat.${id}` : 'explore.categories');
