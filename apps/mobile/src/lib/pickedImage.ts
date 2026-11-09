import { File } from 'expo-file-system';
import { discardCacheCopy } from './cacheFiles';
import { loadManipulator, type ManipulatorLib } from './chatResizer';
import { kindOfMime, type PickedFile } from './sources';

// iPhones save HEIC and many Android phones save HEIC or AVIF; the server takes JPEG, PNG and WebP only.
// The picker is asked for a compatible copy first; this converts whatever still arrives in another still-image format.
const CONVERTIBLE = /^image\/(heic|heif|heic-sequence|heif-sequence|avif|tiff|bmp|gif)$/;
const EXTENSION = /\.(heic|heif|avif|tiff?|bmp|gif)$/i;

export interface PickedAsset { readonly uri: string; readonly mimeType?: string | null; readonly fileName?: string | null; readonly fileSize?: number; readonly width?: number; readonly height?: number }

function needsConversion(asset: PickedAsset): boolean {
    const mime = (asset.mimeType ?? '').trim().toLowerCase();
    if (mime) return CONVERTIBLE.test(mime);
    // Some Android pickers report no type at all: fall back to the file name.
    return EXTENSION.test(asset.fileName ?? asset.uri.split('?')[0]);
}

export async function pickedImageFile(asset: PickedAsset, options: { load?: () => ManipulatorLib; sizeOf?: (uri: string) => number } = {}): Promise<PickedFile> {
    const base: PickedFile = { uri: asset.uri, size: asset.fileSize, mimeType: asset.mimeType ?? undefined, width: asset.width, height: asset.height };
    if (kindOfMime(asset.mimeType ?? undefined) === 'image' || !needsConversion(asset)) return base;
    const lib = (options.load ?? loadManipulator)();
    const rendered = await lib.ImageManipulator.manipulate(asset.uri).renderAsync();
    const saved = await rendered.saveAsync({ compress: 1, format: lib.SaveFormat.JPEG });
    const size = (options.sizeOf ?? ((uri) => new File(uri).size))(saved.uri);
    // Delete only the picker's temporary copy of the original; the converted copy is the one kept.
    discardCacheCopy(asset.uri);
    return { uri: saved.uri, size, mimeType: 'image/jpeg', width: saved.width, height: saved.height };
}
