import { createVideoPlayer } from 'expo-video';

// SDK 58 sourceLoad reports seconds, including sources without video tracks.
// An unreadable audio source fails closed; never substitute the editor's guessed length.
export function probeDuration(uri: string, timeoutMs = 8000): Promise<number | null> {
    return new Promise(resolve => {
        let player: ReturnType<typeof createVideoPlayer> | undefined;
        let finished = false;
        const subscriptions: { remove(): void }[] = [];
        const finish = (seconds: number | null) => {
            if (finished) return;
            finished = true;
            clearTimeout(timer);
            for (const subscription of subscriptions) subscription.remove();
            try { player?.release(); } catch { /* Already released by the native runtime. */ }
            resolve(typeof seconds === 'number' && Number.isFinite(seconds) && seconds > 0 ? seconds : null);
        };
        const timer = setTimeout(() => finish(null), timeoutMs);
        try {
            player = createVideoPlayer(uri);
            subscriptions.push(player.addListener('sourceLoad', event => finish(event.duration)));
            subscriptions.push(player.addListener('statusChange', event => { if (event.status === 'error') finish(null); }));
            if (player.status === 'error') finish(null);
            else if (player.status === 'readyToPlay') finish(player.duration);
        } catch { finish(null); }
    });
}
