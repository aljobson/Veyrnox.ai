import type { VideoThumbnail } from 'expo-video';
import { loadVideo, type FrameDeps } from './chatVideoFrames';
const cache = new Map<string, VideoThumbnail>();
const pending = new Map<string, Promise<VideoThumbnail | null>>();
let active = 0, epoch = 0;
const queue: (() => void)[] = [];
function drain() { while (active < 2 && queue.length) { active++; queue.shift()!(); } }
export function clearPosters() { epoch++; cache.clear(); pending.clear(); }
export function posterFor(jobId: string, url: string, deps?: Pick<FrameDeps, 'createPlayer'>): Promise<VideoThumbnail | null> {
    const cached = cache.get(jobId);
    if (cached) return Promise.resolve(cached);
    const existing = pending.get(jobId);
    if (existing) return existing;
    const version = epoch;
    const work = new Promise<VideoThumbnail | null>(resolve => {
        queue.push(() => void (async () => {
            let player: Awaited<ReturnType<typeof loadVideo>> | undefined;
            let timer: ReturnType<typeof setTimeout> | undefined;
            try {
                if (version !== epoch) { resolve(null); return; }
                const started = Date.now();
                player = await loadVideo(url, deps);
                const frames = await Promise.race([
                    player.generateThumbnailsAsync([Math.min(0.5, player.duration / 2)], { maxWidth: 480, maxHeight: 480 }),
                    new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('poster_timeout')), Math.max(0, 12000 - (Date.now() - started))); }),
                ]);
                const thumbnail = version === epoch ? frames[0] ?? null : null;
                if (thumbnail) cache.set(jobId, thumbnail);
                resolve(thumbnail);
            } catch { resolve(null); }
            finally { clearTimeout(timer); player?.release(); active--; drain(); }
        })());
    });
    pending.set(jobId, work);
    void work.then(() => { if (pending.get(jobId) === work) pending.delete(jobId); });
    drain();
    return work;
}
