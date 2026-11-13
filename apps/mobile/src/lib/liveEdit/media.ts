import { File } from 'expo-file-system';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { createVideoPlayer } from 'expo-video';
import { discardCacheCopy } from '../cacheFiles';
import { validateFrame, type Frame, type FrameId } from './protocol';
export const MAX_CLIP_SECONDS = 15;
export const MAX_PIXELS = 24_000_000;
export type LocalSource = FrameId & { uri: string; width: number; height: number; frame: Frame };
export function validateLocalMedia(uri: string, width: number, height: number, duration?: number | null) {
    if (!/^(file|content):\/\//.test(uri) || !Number.isFinite(width) || !Number.isFinite(height) || Math.min(width, height) < 8 || (duration != null && (!Number.isFinite(duration) || duration <= 0 || duration > MAX_CLIP_SECONDS * 1000))) throw Error('invalid-local-media');
    if (width * height > MAX_PIXELS || Math.max(width, height) > 8192) throw Error('photo-too-large');
}
export async function preparePhoto(uri: string, ids: FrameId): Promise<LocalSource> {
    if (!/^(file|content):\/\//.test(uri)) throw Error('invalid-local-media');
    const context = ImageManipulator.manipulate(uri);
    let full: string | undefined, small: string | undefined;
    try {
        const image = await context.renderAsync();
        try {
            validateLocalMedia(uri, image.width, image.height);
            const saved = await image.saveAsync({ format: SaveFormat.PNG }); full = saved.uri;
            const scale = Math.min(1, 384 / Math.max(image.width, image.height));
            const resized = ImageManipulator.manipulate(full);
            try {
                resized.resize({ width: Math.max(8, Math.round(image.width * scale)), height: Math.max(8, Math.round(image.height * scale)) });
                const thumb = await resized.renderAsync();
                try {
                    const encoded = await thumb.saveAsync({ format: SaveFormat.JPEG, compress: .85, base64: true }); small = encoded.uri;
                    const frame = { ...ids, width: encoded.width, height: encoded.height, jpeg: `data:image/jpeg;base64,${encoded.base64}` };
                    validateFrame(frame);
                    return { ...ids, uri: full, width: image.width, height: image.height, frame };
                } finally { thumb.release(); }
            } finally { resized.release(); }
        } finally { image.release(); }
    } catch (error) { discardCacheCopy(full); throw error; }
    finally { context.release(); discardCacheCopy(small); }
}
// Short clips are local frame sources, not uploads or live-camera sessions.
export async function extractFrame(uri: string, seconds: number, signal: AbortSignal): Promise<string> {
    if (!/^(file|content):\/\//.test(uri) || !Number.isFinite(seconds) || seconds < 0 || seconds > MAX_CLIP_SECONDS || signal.aborted) throw Error('invalid-local-media');
    const player = createVideoPlayer({ uri });
    player.muted = true;
    try {
        await new Promise<void>((resolve, reject) => {
            let settled = false;
            const done = (error?: Error) => { if (settled) return; settled = true; clearTimeout(timer); sub.remove(); signal.removeEventListener('abort', abort); error ? reject(error) : resolve(); };
            const abort = () => done(Error('inference-cancelled'));
            const timer = setTimeout(() => done(Error('clip-timeout')), 15000);
            const sub = player.addListener('statusChange', ({ status }) => { if (status === 'readyToPlay') done(); if (status === 'error') done(Error('clip-unavailable')); });
            signal.addEventListener('abort', abort, { once: true });
            if (signal.aborted) abort(); else if (player.status === 'readyToPlay') done(); else if (player.status === 'error') done(Error('clip-unavailable'));
        });
        const thumbnails = await player.generateThumbnailsAsync([seconds]);
        try {
            if (signal.aborted || !thumbnails[0]) throw Error('inference-cancelled');
            const context = ImageManipulator.manipulate(thumbnails[0]);
            try {
                const image = await context.renderAsync();
                try { return (await image.saveAsync({ format: SaveFormat.PNG })).uri; }
                finally { image.release(); }
            } finally { context.release(); }
        } finally { thumbnails.forEach(t => t.release()); }
    } finally { player.release(); }
}
// Reject remote source URIs even if a caller bypasses the picker.
export function localFileBytes(uri: string) { if (!uri.startsWith('file://')) throw Error('invalid-local-media'); return new File(uri).size; }
