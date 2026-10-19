import * as ImagePicker from 'expo-image-picker';
import { MAX_IMAGE_EDGE, RESIZE_UNAVAILABLE, unavailableResizer, type ChatImage, type ImageResizer } from './chatAttach';
import type { ApiClient } from './api';
import { uploadSource } from './uploads';

export type PhotoResult = { readonly images: ChatImage[]; readonly problem: 'resize_unavailable' | 'failed' | null };

// Photos from the phone. Each is redrawn through the resizer (scaled to the long-edge cap, location data dropped) before it can
// be attached; with the default resizer that is refused, so nothing unprepared is ever sent. The resizer is the one seam to
// swap when expo-image-manipulator is approved.
export async function pickPhotos(room: number, resizer: ImageResizer = unavailableResizer, maxEdge: number = MAX_IMAGE_EDGE): Promise<PhotoResult> {
    if (room <= 0) return { images: [], problem: null };
    const res = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsMultipleSelection: true,
        selectionLimit: room,
        exif: false,
        quality: 1,
    });
    if (res.canceled) return { images: [], problem: null };
    const images: ChatImage[] = [];
    for (const a of res.assets.slice(0, room)) {
        try {
            const prepared = await resizer.prepare({ uri: a.uri, width: a.width, height: a.height }, maxEdge);
            images.push({ id: `f-${images.length}-${Date.now()}`, uri: prepared.uri, preview: prepared.uri, width: a.width, height: a.height });
        } catch (err) {
            return { images, problem: err instanceof Error && err.message === RESIZE_UNAVAILABLE ? 'resize_unavailable' : 'failed' };
        }
    }
    return { images, problem: null };
}

// Uploads the prepared files before anything is charged, so a failed upload costs nothing. Returns the storage keys in order.
export async function uploadChatImages(api: ApiClient, files: readonly ChatImage[], signal: AbortSignal, contentType = 'image/jpeg'): Promise<string[]> {
    const keys: string[] = [];
    for (const f of files) keys.push(await uploadSource(api, { uri: f.uri ?? '' }, contentType, () => undefined, signal));
    return keys;
}
