import { releaseExportPlayback } from '../src/lib/beatNative/exportPlayback';
import { createTakeRecording } from '../src/lib/beatNative/takeRecording';
import { addAudioTrack, configureBeatTakeStorage } from '../src/lib/beatNative/takeShared';
import { createTakeFiles } from '../src/lib/beatNative/takeFiles';
import type { BeatAudio } from '../src/lib/beatNative/audio';
import { deferred, fixedDoc, tick } from './beatNativeFixtures';
import { fakeCapture, fakeContext, takeIO } from './beatNativeTakeFixtures';
import { t } from '../src/lib/i18n';
test('awaits capture release before stop/close/null, then arm and record use the replacement context', async () => {
    configureBeatTakeStorage(createTakeFiles(takeIO()));
    const doc = addAudioTrack(fixedDoc()), captureCalls: unknown[] = [], oldInput = fakeCapture(), newInput = fakeCapture(fakeContext().context), order: string[] = [];
    const old = { recordingEngine: () => ({ context: oldInput.capture.context, resume: async () => {} }), close: jest.fn(async () => { order.push('close'); }) } as unknown as BeatAudio;
    const next = { recordingEngine: () => ({ context: newInput.capture.context, resume: async () => {} }), playRange: jest.fn(async () => ({ contextStart: 0 })), stop: jest.fn() } as unknown as BeatAudio;
    const audio = { current: old as BeatAudio | null };
    const controller = createTakeRecording({ current: () => doc, audio: () => audio.current ?? (audio.current = next), edit: () => true,
        storage: { getItem: () => null, setItem: () => {} }, t, permission: async () => true, audioSession: () => {},
        capture: async context => { captureCalls.push(context); return context === oldInput.capture.context ? oldInput.capture : newInput.capture; }, drain: async () => true });
    await controller.arm(doc.tracks.at(-1)!.id); expect(controller.snapshot().status).toBe('armed');
    await releaseExportPlayback(audio, { current: controller }, () => { expect(oldInput.capture.ended).toBe(true); order.push('stop'); });
    expect(order).toEqual(['stop', 'close']); expect(audio.current).toBeNull();
    await controller.arm(doc.tracks.at(-1)!.id); await controller.record(false);
    expect(captureCalls).toEqual([oldInput.capture.context, newInput.capture.context]); expect(next.playRange).toHaveBeenCalled();
    await controller.dispose();
});
test('pending or failed teardown prevents export and leaves the engine intact', async () => {
    const gate = deferred(), close = jest.fn(), stop = jest.fn(), render = jest.fn();
    const audio = { current: { close } as unknown as BeatAudio };
    const recording = { current: { finishAndDisarm: () => gate.promise } as ReturnType<typeof createTakeRecording> };
    const job = releaseExportPlayback(audio, recording, stop).then(render), rejected = expect(job).rejects.toThrow('capture');
    await tick(); expect(close).not.toHaveBeenCalled(); expect(stop).not.toHaveBeenCalled();
    gate.reject(new Error('capture')); await rejected; expect(render).not.toHaveBeenCalled(); expect(audio.current).not.toBeNull();
});

test('N7-R6: rejecting close clears the old engine, aborts export, and Play creates a fresh engine', async () => {
    const old = { close: jest.fn(async () => { throw new Error('close failed'); }) } as unknown as BeatAudio;
    const fresh = { play: jest.fn(async () => {}) } as unknown as BeatAudio;
    const audio = { current: old as BeatAudio | null }, render = jest.fn(), create = jest.fn(() => fresh);
    await expect(releaseExportPlayback(audio, { current: null }, () => {}).then(render)).rejects.toThrow('close failed');
    expect(audio.current).toBeNull(); expect(render).not.toHaveBeenCalled();
    const engine = () => audio.current ?? (audio.current = create());
    await engine().play(() => fixedDoc());
    expect(create).toHaveBeenCalledTimes(1); expect(fresh.play).toHaveBeenCalled();
});
