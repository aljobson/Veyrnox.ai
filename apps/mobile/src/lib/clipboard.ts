import * as Clipboard from 'expo-clipboard';

// One-tap Copy, like the web's navigator.clipboard (owner decision 2026-10-27).
// Resolves false instead of throwing, so a screen can fall back to the share sheet.
export async function copyText(text: string): Promise<boolean> {
    if (!text) return false;
    try {
        return await Clipboard.setStringAsync(text);
    } catch {
        return false;
    }
}
