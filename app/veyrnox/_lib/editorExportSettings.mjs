import { helperEnglish } from '../../../lib/helperMessages.mjs';
export const EDITOR_EXPORT_HEIGHTS = Object.freeze([360, 480, 720, 1080, 1440, 2160]);
export const EDITOR_EXPORT_RATES = Object.freeze([24, 25, 30, 50, 60]);
export const EXPORT_BITRATES = Object.freeze({ compact: 2000000, standard: 8000000, high: 16000000, maximum: 32000000 });
export function validateExportSettings({ height, frameRate, format, quality }, seconds) {
    if (!EDITOR_EXPORT_HEIGHTS.includes(height) || !EDITOR_EXPORT_RATES.includes(frameRate) || !['mp4', 'mov'].includes(format) || !Object.hasOwn(EXPORT_BITRATES, quality)) return helperEnglish('choose_valid_export_settings');
    if (EXPORT_BITRATES[quality] * seconds / 8 > 400 * 1024 * 1024) return helperEnglish('this_export_exceeds_the_browser_memory_budget_choose');
    return null;
}

