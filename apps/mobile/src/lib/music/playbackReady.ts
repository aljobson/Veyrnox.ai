import type { PlayerPort } from './player';
// One bounded native readiness wait for public and secret-link playback. Cancellation settles it.
export function playbackReady(player: PlayerPort, onStatus: Parameters<PlayerPort['addListener']>[1]) {
    let settle: (ok: boolean) => void = () => {};
    const ready = new Promise<boolean>(resolve => { settle = resolve; });
    const timer = setTimeout(() => settle(false), 30_000);
    const sub = player.addListener('playbackStatusUpdate', status => {
        if (status.error || ['error', 'failed'].includes(status.playbackState)) settle(false);
        else if (status.isLoaded) settle(true);
        onStatus(status);
    });
    if (player.isLoaded) settle(true);
    return { ready: ready.finally(() => clearTimeout(timer)), cancel() { clearTimeout(timer); settle(false); }, detach() { sub.remove(); } };
}
