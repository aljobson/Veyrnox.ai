import type { BeatAudio } from './audio';
import type { TakeRecording } from './takeRecording';
/** Await capture teardown even for an armed input before destroying its engine context. */
export async function releaseExportPlayback(audio: { current: BeatAudio | null }, recording: { current: TakeRecording | null }, stop: () => void) {
    await recording.current?.finishAndDisarm();
    await recording.current?.beforeReplace();
    stop();
    const previous = audio.current;
    try { await previous?.close(); }
    finally { audio.current = null; }
}
