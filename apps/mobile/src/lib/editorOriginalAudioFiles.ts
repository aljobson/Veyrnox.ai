import { Directory, File, Paths } from 'expo-file-system';
import type { AudioPlayer } from 'expo-audio';
import { originalAudioPreset, originalAudioWavBytes } from './editorOriginalAudio';
const pending = new Map<string, Promise<string>>();
export function ensureOriginalAudioFile(id: string): Promise<string> {
    const existing = pending.get(id); if (existing) return existing;
    const task = (async () => {
        const preset = originalAudioPreset(id); if (!preset) throw new Error('Unknown original sound');
        const dir = new Directory(Paths.cache, 'veyrnox-original-audio'); dir.create({ idempotent: true, intermediates: true });
        const file = new File(dir, `${id}-v1.wav`);
        if (file.exists && file.size === 44 + 2 * Math.round(preset.seconds * 48000)) return file.uri;
        try { file.create({ overwrite: true }); await file.write(originalAudioWavBytes(id)); }
        catch (error) { if (file.exists) file.delete(); throw error; }
        return file.uri;
    })();
    pending.set(id, task);
    void task.then(() => pending.delete(id), () => pending.delete(id));
    return task;
}
let audioMode: Promise<void> | undefined;
export function createAudition(onPlaying: (playing: boolean) => void = () => {}) {
    let player: AudioPlayer | undefined, subscription: { remove(): void } | undefined, generation = 0, released = false;
    const stop = () => {
        generation++; subscription?.remove(); subscription = undefined;
        const previous = player; player = undefined; previous?.remove(); onPlaying(false);
    };
    return {
        async play(uri: string) {
            stop(); if (released) return;
            const token = generation;
            // Load native playback only when audition is requested. Opening the editor needs no audio player.
            // eslint-disable-next-line @typescript-eslint/no-require-imports -- Keep native initialization lazy under Metro and Jest.
            const { createAudioPlayer, setAudioModeAsync } = require('expo-audio') as typeof import('expo-audio');
            audioMode ??= setAudioModeAsync({ playsInSilentMode: true }).catch(error => { audioMode = undefined; throw error; });
            await audioMode;
            if (released || token !== generation) return;
            try {
                player = createAudioPlayer({ uri });
                subscription = player.addListener('playbackStatusUpdate', status => { if (status.didJustFinish) stop(); });
                player.play(); onPlaying(true);
            } catch (error) { stop(); throw error; }
        },
        stop,
        release() { released = true; stop(); },
    };
}
