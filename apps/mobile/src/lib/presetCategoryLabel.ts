import { t } from './i18n';
const CATEGORIES = new Set(['ALL', 'NEW', 'POPULAR', 'YOUR PHOTO', 'KIDS BIRTHDAY', 'CINEMATIC', 'ANIME', 'CARTOONS', 'MOVIES', 'FANTASY', 'REALISTIC', 'FASHION', 'PRODUCTS', 'VFX', 'UGC', 'ADS']);
const AUDIO_CATEGORIES = new Set(['MUSIC', 'VOICE-OVER', 'SOUND FX']);
export const isKnownCategory = (id: string): boolean => CATEGORIES.has(id) || AUDIO_CATEGORIES.has(id);
// Keep the id for filtering. Unknown server categories never become visible copy.
export const categoryLabel = (id: string): string => t(CATEGORIES.has(id) ? `presets.cat.${id}` : AUDIO_CATEGORIES.has(id) ? `audioTemplates.cat.${id}` : 'explore.categories');
