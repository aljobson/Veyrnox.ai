import { createTakeRecording } from '../src/lib/beatNative/takeRecording';
import { addAudioTrack, configureBeatTakeStorage, type SongWindow } from '../src/lib/beatNative/takeShared';
import { createTakeFiles } from '../src/lib/beatNative/takeFiles';
import type { BeatAudio } from '../src/lib/beatNative/audio';
import { t } from '../src/lib/i18n';
import { fixedDoc } from './beatNativeFixtures';
import { fakeCapture, takeIO } from './beatNativeTakeFixtures';
export async function failedTakeFixture() {
    configureBeatTakeStorage(createTakeFiles(takeIO()));
    const doc = addAudioTrack(fixedDoc()), input = fakeCapture();
    let window: (value: SongWindow) => void = () => {};
    const engine = { recordingEngine: () => ({ context: input.capture.context, resume: async () => {} }),
        close: jest.fn(async () => {}), stop: jest.fn(),
        playRange: jest.fn(async (options: { onWindow: typeof window }) => { window = options.onWindow; return { contextStart: 0 }; }) };
    const audio = { current: engine as unknown as BeatAudio | null }, edit = jest.fn(() => false);
    const controller = createTakeRecording({ current: () => doc, audio: () => audio.current, edit,
        storage: { getItem: () => null, setItem: () => {} }, t, permission: async () => true,
        capture: async () => input.capture, audioSession: () => {}, drain: async () => true });
    await controller.arm(doc.tracks.at(-1)!.id); await controller.record(false);
    window({ fromSec: 0, toSec: 2, contextTime: 0 });
    input.send({ frame: 0, samples: new Float32Array(2000).fill(0.25) });
    await controller.finish();
    return { doc, audio, engine, controller, edit, input };
}
