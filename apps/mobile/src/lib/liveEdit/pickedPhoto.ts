import * as ImagePicker from 'expo-image-picker';
import { File } from 'expo-file-system';
import { pickedImageFile, type PickedAsset } from '../pickedImage';
import { discardCacheCopy } from '../cacheFiles';
import { preparePhoto, validateLocalMedia } from './media';
import type { FrameId } from './protocol';
export const MAX_PHOTO_BYTES = 50 * 1024 * 1024;
const FORMATS = new Set(['jpeg', 'png', 'webp', 'heic', 'heif', 'heic-sequence', 'heif-sequence', 'avif', 'tiff', 'bmp', 'gif']);
const CONVERTED = new Set(['heic', 'heif', 'heic-sequence', 'heif-sequence', 'avif', 'tiff', 'bmp', 'gif']);
export const pickLiveMedia = () => ImagePicker.launchImageLibraryAsync({
    // Omitting livePhotos returns only the still image, never the paired motion asset.
    mediaTypes: ['images', 'videos'], allowsEditing: false, quality: 1,
    preferredAssetRepresentationMode: ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Compatible,
});
function photoMime(asset: PickedAsset) {
    const mime = (asset.mimeType ?? '').trim().toLowerCase();
    const extension = (asset.fileName ?? asset.uri.split(/[?#]/)[0]).match(/\.([a-z0-9]+)$/i)?.[1].toLowerCase();
    // RAW/ProRAW must not slip through even if a provider incorrectly labels it TIFF.
    if (extension === 'dng' || /(?:dng|raw)/.test(mime)) throw Error('unsupportedFormat');
    let format = !mime || mime === 'application/octet-stream' ? extension : mime.replace(/^image\//, '');
    if (format === 'jpg') format = 'jpeg';
    if (format === 'tif') format = 'tiff';
    if (format === 'x-ms-bmp') format = 'bmp';
    if (!format || !FORMATS.has(format)) throw Error('unsupportedFormat');
    return `image/${format}`;
}
function bytes(size: number | undefined) {
    if (size == null || !Number.isFinite(size) || size <= 0) throw Error('invalid-local-media');
    if (size > MAX_PHOTO_BYTES) throw Error('photo-too-large');
}
export function photoStatus(error: unknown): 'unsupportedFormat' | 'tooLarge' | 'invalid' {
    return error instanceof Error && error.message === 'unsupportedFormat' ? 'unsupportedFormat' : error instanceof Error && error.message === 'photo-too-large' ? 'tooLarge' : 'invalid';
}
export async function preparePickedPhoto(asset: PickedAsset, ids: FrameId) {
    let converted: string | undefined;
    try {
        if (!/^(file|content):\/\//.test(asset.uri)) throw Error('invalid-local-media');
        const mimeType = photoMime(asset);
        if (asset.fileSize !== undefined) bytes(asset.fileSize);
        let picked;
        try { picked = await pickedImageFile({ ...asset, mimeType }); }
        catch { throw Error('unsupportedFormat'); }
        converted = picked.uri;
        bytes(picked.size ?? new File(picked.uri).size);
        validateLocalMedia(picked.uri, picked.width ?? NaN, picked.height ?? NaN);
        try { return await preparePhoto(picked.uri, ids); }
        catch (error) {
            if (error instanceof Error && error.message === 'photo-too-large') throw error;
            if (CONVERTED.has(mimeType.slice(6))) throw Error('unsupportedFormat');
            throw error;
        }
    } finally {
        discardCacheCopy(converted);
        discardCacheCopy(asset.uri);
    }
}
