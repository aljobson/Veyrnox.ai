import { useVideoPlayer } from 'expo-video';
import { useEffect } from 'react';

// Reads a video's real length without showing it: a muted player that is never drawn and never plays. It reports the
// length once the video is ready, or that it could not be read. The length comes from the decoder, so it is what the
// server will measure too. Used by quick edit, which cannot guess a length (ADR-0134).
export function LengthProbe({ url, onLength, onFail }: { url: string; onLength: (seconds: number) => void; onFail: () => void }) {
    const player = useVideoPlayer(url, (p) => {
        p.muted = true;
    });

    useEffect(() => {
        let done = false;
        const finish = (fn: () => void) => {
            if (done) return;
            done = true;
            fn();
        };
        const check = () => {
            if (player.duration > 0 && Number.isFinite(player.duration)) finish(() => onLength(player.duration));
        };
        const sub = player.addListener('statusChange', ({ status }) => {
            if (status === 'readyToPlay') check();
            else if (status === 'error') finish(onFail);
        });
        // It may already be ready by the time the listener is added.
        check();
        // A video that never becomes ready must not leave the screen waiting forever.
        const timer = setTimeout(() => finish(onFail), 20_000);
        return () => {
            sub.remove();
            clearTimeout(timer);
        };
    }, [player, onLength, onFail]);

    return null;
}
