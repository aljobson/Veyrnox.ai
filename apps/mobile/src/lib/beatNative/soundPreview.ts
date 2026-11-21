import { INSTRUMENTS, PRESETS, renderTakeSamples, encodeWav, SYNTH_RATE, type RawTake } from '../instrumentShared';
import { MIN_BPM, MAX_BPM } from './doc';
import { soundDuration, validateSound, type BeatSound } from './labs';
export function soundTake(sound: BeatSound, bpm: number): RawTake & { length: number } {
    if (!validateSound(sound) || !INSTRUMENTS[sound.instrument] || !PRESETS[sound.instrument]?.some(p => p.id === sound.preset)
        || !Number.isFinite(bpm) || bpm < MIN_BPM || bpm > MAX_BPM) throw new Error('invalid_sound');
    return { instrument: sound.instrument, preset: sound.preset, length: soundDuration(sound.id, bpm),
        events: sound.notes.map(([beat, len, pitch, vel]) => ({ at: beat * 60 / bpm, dur: len * 60 / bpm, value: pitch, vel })).sort((a, b) => a.at - b.at) };
}
export function renderSoundWav(sound: BeatSound, bpm: number): ArrayBuffer {
    return encodeWav(renderTakeSamples(soundTake(sound, bpm)), SYNTH_RATE);
}
export type PreviewPort = {
    prepare(): Promise<void>; write(wav: ArrayBuffer): { uri: string; remove(): void };
    player(uri: string): { play(): void; pause(): void; remove(): void;
        addListener(event: 'playbackStatusUpdate', listener: (status: { didJustFinish: boolean }) => void): { remove(): void };
    };
};
function nativePort(): PreviewPort {
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- lazy native playback
    const audio: typeof import('expo-audio') = require('expo-audio');
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- lazy native cache
    const fs: typeof import('expo-file-system') = require('expo-file-system');
    return { prepare: () => audio.setAudioModeAsync({ playsInSilentMode: true }),
        write(wav) { const file = new fs.File(fs.Paths.cache, `beat-sound-${Date.now()}-${Math.random().toString(36).slice(2)}.wav`);
            try { file.create({ overwrite: true }); file.write(new Uint8Array(wav)); }
            catch (error) { try { if (file.exists) file.delete(); } catch { /* Best-effort failed-cache cleanup. */ } throw error; }
            return { uri: file.uri, remove: () => file.delete() }; },
        player: uri => audio.createAudioPlayer({ uri }) };
}
export function createSoundPreview(port?: PreviewPort, onFinish: () => void = () => {}) {
    let current: string | null = null, generation = 0;
    let player: ReturnType<PreviewPort['player']> | undefined, file: ReturnType<PreviewPort['write']> | undefined;
    let subscription: { remove(): void } | undefined;
    function stop() {
        generation++; current = null;
        try { subscription?.remove(); } catch { /* Already released. */ }
        subscription = undefined;
        try { player?.pause(); } catch { /* Already released. */ }
        try { player?.remove(); } catch { /* Already released. */ }
        try { file?.remove(); } catch { /* Cache eviction is harmless. */ }
        player = undefined; file = undefined;
    }
    return { stop, async toggle(sound: BeatSound, bpm: number) {
        const same = current === sound.id; stop(); if (same) return null;
        current = sound.id; const ticket = generation;
        try {
            const native = port ??= nativePort();
            await native.prepare();
            // Let the sheet commit its busy state before synchronous synthesis.
            await new Promise<void>(resolve => setTimeout(resolve, 0));
            if (ticket !== generation) return null;
            file = native.write(renderSoundWav(sound, bpm)); player = native.player(file.uri);
            subscription = player.addListener('playbackStatusUpdate', status => {
                if (ticket === generation && status.didJustFinish) { stop(); onFinish(); }
            });
            player.play();
            return current;
        } catch (error) { if (ticket === generation) stop(); throw error; }
    } };
}
