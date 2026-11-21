import { extractFrames } from './chatVideoFrames';
import * as ImagePicker from 'expo-image-picker';
import { MAX_IMAGE_EDGE, RESIZE_UNAVAILABLE, type ChatImage, type ImageResizer } from './chatAttach';
import { createResizer } from './chatResizer';
import { File } from 'expo-file-system';
import { ApiError, type ApiClient } from './api';
import { uploadSource, type PutFile } from './uploads';

export type PhotoResult = { readonly images: ChatImage[]; readonly problem: 'resize_unavailable' | 'failed' | null };

// Photos from the phone. Each goes through the resizer (long edge capped, upright, re-encoded as JPEG so location data is
// dropped) before it can be attached; if that fails nothing unprepared is sent.
export async function pickPhotos(room: number, resizer: ImageResizer = createResizer(), maxEdge: number = MAX_IMAGE_EDGE): Promise<PhotoResult> {
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

export interface ChatUploadDeps {
    readonly sizeOf?: (uri: string) => number;
    readonly put?: PutFile;
}

// Uploads the prepared files before anything is charged, so a failed upload costs nothing. Returns the storage keys in order.
// The upload route refuses a request without the file's byte size, so each prepared file (resized photo or video frame) is
// measured on disk first; one that cannot be measured is refused here rather than sent.
export async function uploadChatImages(api: ApiClient, files: readonly ChatImage[], signal: AbortSignal, contentType = 'image/jpeg', deps: ChatUploadDeps = {}): Promise<string[]> {
    const sizeOf = deps.sizeOf ?? ((uri: string) => new File(uri).size);
    const keys: string[] = [];
    for (const f of files) {
        const uri = f.uri ?? '';
        const size = sizeOf(uri);
        if (!Number.isInteger(size) || size <= 0) throw new ApiError(0, 'upload_failed');
        keys.push(await uploadSource(api, { uri, size }, contentType, () => undefined, signal, deps.put));
    }
    return keys;
}

export type VideoResult = { images: ChatImage[]; problem: 'room' | 'video_none' | 'video_unreadable' | null };

export async function pickVideoFrames(room: number, deps = { pick: ImagePicker.launchImageLibraryAsync, extract: extractFrames }, onReading?: () => void, readMs = 30000): Promise<VideoResult> {
    if (room < 2) return { images: [], problem: 'room' };
    let timer: ReturnType<typeof setTimeout> | undefined;
    const cancel = { cancelled: false };
    try {
        const result = await deps.pick({ mediaTypes: ['videos'], allowsMultipleSelection: false });
        // A cancelled picker and an empty library look the same to the app, so both get the neutral 'No video was chosen' note.
        if (result.canceled) return { images: [], problem: 'video_none' };
        const uri = result.assets?.[0]?.uri;
        if (!uri) return { images: [], problem: 'video_none' };
        onReading?.();
        const deadline = new Promise<never>((_, reject) => {
            timer = setTimeout(() => {
                cancel.cancelled = true;
                reject(new Error('video_unreadable'));
            }, readMs);
        });
        const uris = await Promise.race([deps.extract(uri, Math.min(4, room), undefined, cancel), deadline]);
        return { images: uris.map((uri, i) => ({ id: `v-${Date.now()}-${i}`, video: true, uri, preview: uri })), problem: null };
    } catch { return { images: [], problem: 'video_unreadable' }; }
    finally { clearTimeout(timer); }
}
