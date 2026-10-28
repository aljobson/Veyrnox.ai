import type { VideoPlayer, VideoThumbnail } from 'expo-video';
import type { ImageManipulatorContext } from 'expo-image-manipulator';

export function frameTimes(duration: number, count: number): number[] {
    if (!Number.isFinite(duration) || duration <= 0 || !Number.isInteger(count) || count < 1) return [];
    const last = Math.max(0, duration - 0.05);
    return Array.from({ length: count }, (_, i) => Math.min(last, (duration * (i + 0.5)) / count));
}
export interface FrameDeps {
    createPlayer: (uri: string) => Pick<VideoPlayer, 'status' | 'duration' | 'addListener' | 'generateThumbnailsAsync' | 'release'>;
    manipulate: (image: VideoThumbnail) => Pick<ImageManipulatorContext, 'renderAsync'>;
}
function nativeDeps(): FrameDeps {
    try {
        const video = require('expo-video') as typeof import('expo-video');
        const image = require('expo-image-manipulator') as typeof import('expo-image-manipulator');
        return { createPlayer: video.createVideoPlayer, manipulate: source => image.ImageManipulator.manipulate(source) };
    } catch { throw new Error('video_unreadable'); }
}
function timeout<T>(work: Promise<T>): Promise<T> {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('video_unreadable')), 12000);
        work.then(value => { clearTimeout(timer); resolve(value); }, error => { clearTimeout(timer); reject(error); });
    });
}
export async function loadVideo(uri: string, deps?: Pick<FrameDeps, 'createPlayer'>) {
    let player: ReturnType<FrameDeps['createPlayer']> | undefined;
    const subscriptions: { remove(): void }[] = [];
    try {
        player = (deps ?? nativeDeps()).createPlayer(uri);
        const p = player;
        await timeout(new Promise<void>((resolve, reject) => {
            const check = () => {
                if (p.status === 'error') reject(new Error('video_unreadable'));
                else if (p.status === 'readyToPlay' && p.duration > 0) resolve();
            };
            subscriptions.push(p.addListener('sourceLoad', () => { if (p.duration > 0) resolve(); }));
            subscriptions.push(p.addListener('statusChange', e => { if (e.status === 'error') reject(new Error('video_unreadable')); else check(); }));
            check();
        }));
        subscriptions.splice(0).forEach(s => s.remove());
        return player;
    } catch { player?.release(); throw new Error('video_unreadable'); }
    finally { subscriptions.forEach(s => s.remove()); }
}
export async function extractFrames(uri: string, count: number, deps?: FrameDeps): Promise<string[]> {
    let player: ReturnType<FrameDeps['createPlayer']> | undefined;
    try {
        const lib = deps ?? nativeDeps();
        player = await loadVideo(uri, lib);
        const times = frameTimes(player.duration, count);
        if (!times.length) throw new Error('video_unreadable');
        const thumbnails = await timeout(player.generateThumbnailsAsync(times, { maxWidth: 1280, maxHeight: 1280 }));
        if (thumbnails.length !== count) throw new Error('video_unreadable');
        const uris: string[] = [];
        for (const thumbnail of thumbnails) {
            const rendered = await timeout(lib.manipulate(thumbnail).renderAsync());
            try {
                const saved = await timeout(rendered.saveAsync({ compress: 0.85, format: 'jpeg' as import('expo-image-manipulator').SaveFormat }));
                uris.push(saved.uri);
            } finally { rendered.release?.(); }
        }
        return uris;
    } catch { throw new Error('video_unreadable'); }
    finally { player?.release(); }
}
