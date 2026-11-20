import { arrangementBars, dragValue, laneAt, positionParts, tickToX, xToTick } from '../src/lib/beatNative/arrange';
import { createBeat, setCycle, setView, snapTick } from '../src/lib/beatNative/doc';
import { createBeatAudioFromEngine, playRange } from '../src/lib/beatNative/audio';
const beat = () => createBeat({ id: '00000000-0000-4000-8000-000000000001' });
const region = { id: 'r1', start: 3840, length: 3840 };
test.each([240, 480, 960, 3840])('web move/trim/resize math at snap %i, including clamps', snap => {
    for (const delta of [-20000, -1000, -240, 0, 700, 6000]) {
        const start = Math.max(0, snapTick(region.start + delta, snap));
        expect(dragValue(region, 'move', delta, snap, 't2')).toEqual({ ...region, start, trackId: 't2' });
        const trim = Math.min(start, 7440);
        expect(dragValue(region, 'trim', delta, snap, 't1')).toEqual({ ...region, start: trim, length: 7680 - trim, trackId: 't1' });
        expect(dragValue(region, 'resize', delta, snap, 't1').length).toBe(Math.max(240, snapTick(7680 + delta, snap) - 3840));
    }
});
test('phone geometry and position parts use ticks, measured lanes and bounded bars', () => {
    expect(tickToX(3840, 96)).toBe(96); expect(xToTick(48, 96)).toBe(1920);
    expect([-50, 50, 110, 280, 900].map(y => laneAt(y, [96, 140, 96]))).toEqual([0, 0, 1, 2, 2]);
    expect(positionParts(8880)).toEqual({ bar: 3, beat: 2, step: 2 });
    expect(arrangementBars(beat(), 0)).toBe(16); expect(arrangementBars(beat(), 100000000)).toBe(512);
    expect(arrangementBars(beat(), 20 * 3840)).toBe(24);
});
test('playRange handles pattern, song and song cycle', () => {
    const doc = beat();
    expect(playRange(setView(doc, 'pattern'))).toEqual({ from: 0, to: 16 });
    expect(playRange(doc)).toEqual({ from: 0, to: 64 });
    expect(playRange(setCycle(doc, { on: true, start: 960, end: 1920 }))).toEqual({ from: 4, to: 8 });
});
test('audio reports global cycle steps and re-reads edits even inside one lookahead tick', async () => {
    let now = 0, fire = () => {};
    const node = () => ({ gain: { value: 1 }, pan: { value: 0 }, connect: jest.fn() });
    const playPad = jest.fn();
    const engine = { now: () => now, context: { destination: {}, createGain: node, createStereoPanner: node }, resume: async () => {}, close: async () => {}, playPad };
    let doc = setCycle(beat(), { on: true, start: 960, end: 1920 });
    const steps: number[] = [];
    const audio = createBeatAudioFromEngine({ engine: engine as never, setTimer: fn => { fire = fn; return 1; }, clearTimer: () => {} });
    await audio.play(() => doc, step => steps.push(step));
    now = 1.5; fire();
    expect(steps).toEqual([4, 5, 6, 7, 4, 5, 6, 7, 4, 5]);
    expect(playPad.mock.calls.every(call => ['snare', 'hat'].includes(call[0]))).toBe(true);
    doc = setCycle(doc, { on: true, start: 1920, end: 2400 });
    now += 0.5; fire(); expect(steps.slice(10).every(step => step === 8 || step === 9)).toBe(true);
    audio.stop();
    const changing: number[] = [];
    doc = setView(doc, 'pattern'); now = 0;
    await audio.play(() => doc, step => { changing.push(step); if (changing.length === 2) doc = setView(setCycle(doc, { on: true, start: 1920, end: 2400 }), 'song'); });
    now = 1; fire(); expect(changing.slice(0, 2)).toEqual([0, 1]); expect(changing.slice(2).every(step => step === 8 || step === 9)).toBe(true);
    audio.stop();
});
