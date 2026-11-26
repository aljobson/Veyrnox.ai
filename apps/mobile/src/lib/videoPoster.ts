import type { VideoThumbnail } from 'expo-video';
import { loadVideo, type FrameDeps } from './chatVideoFrames';
const cache = new Map<string, VideoThumbnail>();
const pending = new Map<string, Promise<VideoThumbnail | null>>();
let active = 0, epoch = 0;
const queue: (() => void)[] = [];
function drain() { while (active < 2 && queue.length) { active++; queue.shift()!(); } }
export function clearPosters() { epoch++; cache.clear(); pending.clear(); }
export function posterFor(jobId: string, url: string, deps?: Pick<FrameDeps, 'createPlayer'>, timeSeconds?: number): Promise<VideoThumbnail | null> {
    const key = timeSeconds === undefined ? jobId : `${jobId}@${Math.max(0, timeSeconds).toFixed(3)}`;
    const cached = cache.get(key);
    if (cached) return Promise.resolve(cached);
    const existing = pending.get(key);
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
                const defaultTime = Math.min(0.5, player.duration / 2);
                const requestedTime = timeSeconds === undefined ? defaultTime : Math.max(0, timeSeconds);
                const targetTime = player.duration > 0 ? Math.min(requestedTime, Math.max(0, player.duration - .001)) : 0;
                const frames = await Promise.race([
                    player.generateThumbnailsAsync([targetTime], { maxWidth: 480, maxHeight: 480 }),
                    new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('poster_timeout')), Math.max(0, 12000 - (Date.now() - started))); }),
                ]);
                const thumbnail = version === epoch ? frames[0] ?? null : null;
                if (thumbnail) cache.set(key, thumbnail);
                resolve(thumbnail);
            } catch { resolve(null); }
            finally { clearTimeout(timer); player?.release(); active--; drain(); }
        })());
    });
    pending.set(key, work);
    void work.then(() => { if (pending.get(key) === work) pending.delete(key); });
    drain();
    return work;
}
