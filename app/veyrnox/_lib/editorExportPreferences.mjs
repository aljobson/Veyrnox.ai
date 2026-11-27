import { EDITOR_EXPORT_HEIGHTS, EDITOR_EXPORT_RATES, EXPORT_BITRATES } from './editorExportSettings.mjs';

export const EDITOR_EXPORT_PREFERENCES_KEY = 'veyrnox.editor-export.v1';
export const DEFAULT_EDITOR_EXPORT_PREFERENCES = Object.freeze({ height: 720, frameRate: 30, format: 'mp4', quality: 'standard' });

export function validEditorExportPreferences(value) {
    return value && typeof value === 'object' && !Array.isArray(value)
        && Object.keys(value).length === 4 && ['height', 'frameRate', 'format', 'quality'].every(key => Object.hasOwn(value, key))
        && EDITOR_EXPORT_HEIGHTS.includes(value.height) && EDITOR_EXPORT_RATES.includes(value.frameRate)
        && ['mp4', 'mov'].includes(value.format) && Object.hasOwn(EXPORT_BITRATES, value.quality);
}

export function readEditorExportPreferences(storage) {
    try {
        const value = JSON.parse(storage?.getItem(EDITOR_EXPORT_PREFERENCES_KEY) ?? 'null');
        return validEditorExportPreferences(value) ? value : DEFAULT_EDITOR_EXPORT_PREFERENCES;
    } catch { return DEFAULT_EDITOR_EXPORT_PREFERENCES; }
}

export function writeEditorExportPreferences(storage, value) {
    if (!validEditorExportPreferences(value)) return false;
    try { storage?.setItem(EDITOR_EXPORT_PREFERENCES_KEY, JSON.stringify(value)); return !!storage; }
    catch { return false; }
}
