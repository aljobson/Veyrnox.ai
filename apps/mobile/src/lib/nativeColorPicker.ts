import { Platform } from 'react-native';
import { optionalEditorMediaModule } from './editorMedia/native';

export function nativeColorPickerAvailable(): boolean {
    return Platform.OS === 'ios' && typeof optionalEditorMediaModule()?.pickColor === 'function';
}

export async function pickNativeColor(initialHex: string): Promise<string | null> {
    if (!nativeColorPickerAvailable()) return null;
    const module = optionalEditorMediaModule();
    if (!module?.pickColor) return null;
    try {
        const color = await module.pickColor(initialHex);
        return typeof color === 'string' && /^#[0-9a-fA-F]{6}$/.test(color) ? color.toUpperCase() : null;
    } catch { return null; }
}
