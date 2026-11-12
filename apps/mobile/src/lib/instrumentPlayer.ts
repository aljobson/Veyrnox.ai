import { createAudioPlayer, setAudioModeAsync, type AudioPlayer } from 'expo-audio';
import { File, Paths } from 'expo-file-system';
// @ts-expect-error shared plain-JS module outside the app root (Metro watches ../../lib)
import { renderTakeSamples, renderVoiceWav, SYNTH_RATE } from '../../../../lib/musicInstrumentSynth.js';
// @ts-expect-error shared plain-JS module outside the app root
import { encodeWav, normalizeTake, trimSamples } from '../../../../lib/musicInstruments.js';

export type RawTake = { instrument: string; preset: string; events: { at: number; dur: number; vel: number; value: number | string }[] };

const MAX_PLAYERS = 24;
const players = new Map<string, AudioPlayer>();

function writeWav(name: string, wav: ArrayBuffer): string {
    const file = new File(Paths.cache, name);
    file.create({ overwrite: true });
    file.write(new Uint8Array(wav));
    return file.uri;
}

export async function prepareInstrumentAudio(): Promise<void> {
    try { await setAudioModeAsync({ playsInSilentMode: true }); } catch { /* Playback still works with the default mode. */ }
}

/** Render a voice once, cache its file and player, and replay from the start on every tap. */
export function playVoice(instrument: string, preset: string, value: number | string, vel = 0.85): void {
    const key = `${instrument}:${preset}:${value}`;
    let player = players.get(key);
    if (!player) {
        if (players.size >= MAX_PLAYERS) releaseInstrumentAudio();
        const uri = writeWav(`veyrnox-inst-${key.replace(/[^A-Za-z0-9]/g, '_')}.wav`, renderVoiceWav(instrument, preset, value, vel, instrument === 'piano' ? 1.2 : 0.8));
        player = createAudioPlayer({ uri });
        players.set(key, player);
    }
    try { player.seekTo(0); player.play(); } catch { /* A released player is rebuilt on the next tap. */ players.delete(key); }
}

export function releaseInstrumentAudio(): void {
    players.forEach((player) => { try { player.remove(); } catch { /* Already released. */ } });
    players.clear();
}

export type RenderedTake = { uri: string; seconds: number };

/** Mix a recorded take to a WAV in the cache, trimmed to [start, end] seconds. */
export function renderTakeFile(raw: RawTake, start = 0, end?: number): RenderedTake | null {
    const take = normalizeTake(raw);
    if (!take) return null;
    const mixed: Float32Array = renderTakeSamples(take);
    const clip: Float32Array = trimSamples(mixed, SYNTH_RATE, start, end ?? mixed.length / SYNTH_RATE);
    const uri = writeWav(`veyrnox-take-${take.instrument}-${take.preset}-${Date.now()}.wav`, encodeWav(clip, SYNTH_RATE));
    return { uri, seconds: clip.length / SYNTH_RATE };
}

export function playFile(uri: string): AudioPlayer {
    const player = createAudioPlayer({ uri });
    player.play();
    return player;
}
