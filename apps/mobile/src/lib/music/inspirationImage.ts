import { File } from 'expo-file-system';
import { MAX_IMAGE_EDGE } from '../chatAttach';
import { createResizer } from '../chatResizer';
import { discardCacheCopy } from '../cacheFiles';

export const MUSIC_INSPIRATION_IMAGE_MAX_BYTES = 8 * 1024 * 1024;
export const MUSIC_INSPIRATION_IMAGE_MAX_EDGE = MAX_IMAGE_EDGE;

export interface InspirationImageAsset {
    readonly uri: string;
    readonly width?: number;
    readonly height?: number;
}

export interface PreparedInspirationImage {
    readonly uri: string;
    readonly size: number;
    readonly mimeType: 'image/jpeg';
}

type Prepared = { readonly uri: string; readonly contentType: string };
type Prepare = (asset: InspirationImageAsset) => Promise<Prepared>;

const defaultPrepare: Prepare = async asset => createResizer().prepare({
    uri: asset.uri,
    width: Number.isFinite(asset.width) && (asset.width as number) > 0 ? asset.width as number : 1,
    height: Number.isFinite(asset.height) && (asset.height as number) > 0 ? asset.height as number : 1,
}, MUSIC_INSPIRATION_IMAGE_MAX_EDGE);

// The returned file is always a newly rendered JPEG. The picked original is
// never eligible for upload because it may still contain GPS/EXIF metadata.
export async function prepareMusicInspirationImage(asset: InspirationImageAsset, options: {
    readonly prepare?: Prepare;
    readonly sizeOf?: (uri: string) => number;
} = {}): Promise<PreparedInspirationImage> {
    if (!/^(file|content):\/\//.test(asset.uri)) throw new Error('image_invalid');
    let prepared: Prepared | undefined;
    try {
        prepared = await (options.prepare ?? defaultPrepare)(asset);
        if (prepared.uri === asset.uri || prepared.contentType !== 'image/jpeg') throw new Error('image_type');
        const size = (options.sizeOf ?? (uri => new File(uri).size))(prepared.uri);
        if (!Number.isSafeInteger(size) || size <= 0) throw new Error('image_invalid');
        if (size > MUSIC_INSPIRATION_IMAGE_MAX_BYTES) throw new Error('image_too_large');
        return { uri: prepared.uri, size, mimeType: 'image/jpeg' };
    } catch (error) {
        if (prepared?.uri !== asset.uri) discardCacheCopy(prepared?.uri);
        throw error;
    }
}
