import { BEST_CUT_LANGUAGES } from './bestCutPlan';
import * as SecureStore from 'expo-secure-store';
export type BestCutSettings = { captions: boolean; language: string };
const key = 'veyrnox.bestCut.settings.v1';
export async function readBestCutSettings(): Promise<BestCutSettings> {
    try { const value = JSON.parse(await SecureStore.getItemAsync(key) || '{}'); return { captions: value.captions !== false, language: BEST_CUT_LANGUAGES.some(language => language === value.language) ? value.language : 'auto' }; }
    catch { return { captions: true, language: 'auto' }; }
}
export const writeBestCutSettings = (value: BestCutSettings) => SecureStore.setItemAsync(key, JSON.stringify(value));
