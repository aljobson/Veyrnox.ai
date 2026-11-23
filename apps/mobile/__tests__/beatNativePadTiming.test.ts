import { createBeatAudioFromEngine } from '../src/lib/beatNative/audio';
import { createNativeBeatEngine } from '../src/lib/beatNative/nativeContext';
import { createBeat, eventTime, setCycle, stepSeconds, type BeatDoc } from '../src/lib/beatNative/doc';
import { mockAudioContextClass } from './helpers/mockNativeAudio';

const make = (): BeatDoc => createBeat({ id: '00000000-0000-4000-8000-000000000091' });

function build(doc: BeatDoc) {
    const { Ctor, state } = mockAudioContextClass();
    const { engine } = createNativeBeatEngine({ Context: Ctor });
    const setTimer = jest.fn((fn: () => void) => fn);
    const clearTimer = jest.fn();
    const audio = createBeatAudioFromEngine({ engine, setTimer, clearTimer });
    return { audio, context: state.last!.context, engine, setTimer, clearTimer, read: () => doc };
}

beforeEach(() => jest.useFakeTimers());
afterEach(() => { jest.clearAllTimers(); jest.useRealTimers(); });

test('pad audition returns the audio-clock time captured before resume work', async () => {
    const b = build(make());
    const playPad = jest.spyOn(b.engine, 'playPad');
    b.context.currentTime = 2.75;
    expect(b.audio.hitPad('snare', 'lofi')).toBe(2.75);
    expect(playPad).toHaveBeenCalledWith('snare', 100 / 127, 2.75, expect.anything(), 'lofi');
    await b.audio.close();
});

test('nearest step includes the next unscheduled slow-tempo candidate and keeps the earlier midpoint tie', async () => {
    const doc = { ...make(), view: 'pattern' as const, tempo: { bpm: 40 }, swing: 0 };
    const b = build(doc);
    await b.audio.play(b.read);
    const first = 0.1;
    const second = first + stepSeconds(40);
    expect(b.audio.nearestStepAt(second - 0.01)).toEqual({ step: 1, time: second });
    expect(b.audio.nearestStepAt((first + second) / 2)).toEqual({ step: 0, time: first });
    // A synchronous nearest-step refill must not install a second timer chain.
    expect(b.setTimer).toHaveBeenCalledTimes(1);
    await b.audio.close();
});

test('nearest step uses the same swung onset that schedules pad audio', async () => {
    const doc = { ...make(), view: 'pattern' as const, tempo: { bpm: 120 }, swing: 0.5 };
    const b = build(doc);
    await b.audio.play(b.read);
    const straight = 0.1 + stepSeconds(120);
    const swung = eventTime(straight, 1, 120, 0.5);
    expect(b.audio.nearestStepAt(swung - 0.001)).toEqual({ step: 1, time: swung });
    await b.audio.close();
});

test('timer-free refill advances the bounded schedule through a song cycle', async () => {
    const doc = setCycle({ ...make(), tempo: { bpm: 240 } }, { on: true, start: 960, end: 1920 });
    const b = build(doc);
    await b.audio.play(b.read);
    expect(b.audio.nearestStepAt(0.1)?.step).toBe(4);
    b.context.currentTime = 1.5;
    const nearest = b.audio.nearestStepAt(1.5);
    expect(nearest).not.toBeNull();
    expect([4, 5, 6, 7]).toContain(nearest!.step);
    expect(b.setTimer).toHaveBeenCalledTimes(1);
    await b.audio.close();
});

test('stop clears scheduled timing and a restart begins from the new audio clock', async () => {
    const doc = { ...make(), view: 'pattern' as const };
    const b = build(doc);
    expect(b.audio.nearestStepAt(0)).toBeNull();
    await b.audio.play(b.read);
    expect(b.audio.nearestStepAt(0.1)).toEqual({ step: 0, time: 0.1 });
    b.audio.stop();
    expect(b.audio.nearestStepAt(0.1)).toBeNull();
    b.context.currentTime = 5;
    await b.audio.play(b.read);
    expect(b.audio.nearestStepAt(5.1)).toEqual({ step: 0, time: 5.1 });
    await b.audio.close();
});
