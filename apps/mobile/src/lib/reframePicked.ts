import { File } from 'expo-file-system';

import { cropRect } from './aspectFrame';
import { JPEG_QUALITY, loadManipulator, type ManipulatorLib } from './chatResizer';
import { discardCacheCopy } from './cacheFiles';
import type { PickedFile } from './sources';

interface Rendered {
    readonly width: number;
    readonly height: number;
    release?(): void;
    saveAsync(options: { compress: number; format: string }): Promise<{ uri: string; width: number; height: number }>;
}
interface Cropping {
    crop(rect: { originX: number; originY: number; width: number; height: number }): Cropping;
    renderAsync(): Promise<Rendered>;
}

/**
 * Centre-crops a picked photo to a frame ratio before upload. Returns the photo as it is when no crop is needed; the crop
 * is a new JPEG in the app's cache that the caller owns (see `framed`). Throws when the native module is missing.
 */
export async function reframePicked(
    file: PickedFile,
    ratio: string,
    load: () => ManipulatorLib = loadManipulator,
    sizeOf: (uri: string) => number | undefined = (uri) => new File(uri).size,
): Promise<PickedFile & { readonly framed: boolean }> {
    const lib = load();
    const manipulate = lib.ImageManipulator.manipulate as unknown as (uri: string) => Cropping;
    // Rendering applies the camera's rotation, so this is the size the person sees (the picker's own can be unrotated).
    const upright = await manipulate(file.uri).renderAsync();
    const { width, height } = upright;
    upright.release?.();
    const rect = cropRect(width, height, ratio);
    if (!rect) return { ...file, framed: false };
    const out = await manipulate(file.uri).crop(rect).renderAsync();
    try {
        const saved = await out.saveAsync({ compress: JPEG_QUALITY, format: lib.SaveFormat.JPEG });
        // The upload declares the byte size to the server (POST /api/v1/uploads size_bytes): a copy without one is refused.
        const size = sizeOf(saved.uri);
        if (!(typeof size === 'number' && size > 0)) { discardFramed(saved.uri); return { ...file, framed: false }; }
        return { uri: saved.uri, size, mimeType: 'image/jpeg', width: saved.width, height: saved.height, framed: true };
    } finally { out.release?.(); }
}

export const discardFramed = (uri: string | undefined): void => discardCacheCopy(uri);
