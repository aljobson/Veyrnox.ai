import * as DocumentPicker from 'expo-document-picker';
import { File } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { exportDirectory } from './appCache';
import type { CaptionFile } from './editorCaptionEdit';
type PickedCaption = { text: string; name: string } | { refused: 'fileTooLarge' | 'fileUnreadable' } | null;
export async function pickCaptionFile(live: () => boolean = () => true): Promise<PickedCaption> {
    let file: File | undefined;
    try {
        const result = await DocumentPicker.getDocumentAsync({ type: ['*/*'], copyToCacheDirectory: true, multiple: false });
        if (result.canceled) return null;
        const asset = result.assets[0]; file = new File(asset.uri);
        if (!live()) return null;
        if (asset.size !== undefined && asset.size > 262144) return { refused: 'fileTooLarge' };
        const text = await file.text();
        return live() ? { text, name: asset.name } : null;
    } catch { return live() ? { refused: 'fileUnreadable' } : null; }
    finally { try { file?.delete(); } catch { /* Best effort private cache cleanup. */ } }
}
export async function shareCaptionFile(data: CaptionFile, live: () => boolean = () => true): Promise<'unavailable' | void> {
    const available = await Sharing.isAvailableAsync();
    if (!live()) return;
    if (!available) return 'unavailable';
    const directory = exportDirectory(); directory.create({ intermediates: true, idempotent: true });
    const file = new File(directory, data.name);
    try {
        file.create({ overwrite: true }); file.write(data.body);
        if (!live()) return;
        await Sharing.shareAsync(file.uri, { mimeType: data.mimeType, UTI: data.uti });
    } finally { try { file.delete(); } catch { /* Best effort private cache cleanup. */ } }
}
