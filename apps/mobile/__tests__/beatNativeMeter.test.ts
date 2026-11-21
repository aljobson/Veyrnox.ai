import { peakDb, meterText, subscribeMeter } from '../src/lib/beatNative/meter';
import type { BeatAudio } from '../src/lib/beatNative/audio';
import { t } from '../src/lib/i18n';

beforeEach(() => jest.useFakeTimers());
afterEach(() => { jest.restoreAllMocks(); jest.clearAllTimers(); jest.useRealTimers(); });
function fakeAudio() {
    const tap = { connect: jest.fn(), disconnect: jest.fn() };
    const analyser = () => ({ fftSize: 0, getFloatTimeDomainData: jest.fn((samples: Float32Array) => samples.fill(0.5)), disconnect: jest.fn() });
    const createAnalyser = jest.fn(analyser);
    const audio = { context: { createAnalyser }, meterTap: jest.fn(() => tap as typeof tap | null) } as unknown as BeatAudio;
    return { audio, tap, createAnalyser, meterTap: audio.meterTap as jest.Mock };
}
test('peak maths clamps silence/full scale/half scale to -60/0/about -6 dB', () => {
    expect(peakDb(new Float32Array(256))).toBe(-60);
    expect(peakDb([0, -1, 0.2])).toBe(0); expect(peakDb([0.5])).toBeCloseTo(-6.0206);
    expect(peakDb([2])).toBe(0); expect(peakDb([1e-9])).toBe(-60); expect(peakDb([])).toBe(-60);
    expect(meterText(-60)).toBe(t('beatMix.meter.value', { value: '−∞' }));
});
test('N meters share one interval and detach only their analyser on unmount', () => {
    const a = fakeAudio(), loop = jest.spyOn(global, 'setInterval');
    const read1 = jest.fn(), read2 = jest.fn();
    const one = subscribeMeter(a.audio, 't1', false, read1), two = subscribeMeter(a.audio, 'master', false, read2);
    expect(loop).toHaveBeenCalledTimes(1); expect(jest.getTimerCount()).toBe(1);
    const first = a.createAnalyser.mock.results[0].value, second = a.createAnalyser.mock.results[1].value;
    expect(first.fftSize).toBe(256); expect(a.tap.connect).toHaveBeenCalledWith(first);
    jest.advanceTimersByTime(1000); expect(read1.mock.calls.length).toBeGreaterThanOrEqual(15);
    one(); expect(a.tap.disconnect).toHaveBeenCalledWith(first); expect(first.disconnect).toHaveBeenCalledTimes(1);
    expect(jest.getTimerCount()).toBe(1); expect(second.disconnect).not.toHaveBeenCalled();
    two(); expect(second.disconnect).toHaveBeenCalledTimes(1); expect(jest.getTimerCount()).toBe(0);
});
test('reduced motion uses 4Hz, tap changes disconnect, and stopped audio reads silence', () => {
    const a = fakeAudio(), read = jest.fn();
    const stop = subscribeMeter(a.audio, 't1', true, read);
    const first = a.createAnalyser.mock.results[0].value;
    jest.advanceTimersByTime(1000); expect(read).toHaveBeenCalledTimes(5);
    const next = { connect: jest.fn(), disconnect: jest.fn() }; a.meterTap.mockReturnValue(next);
    jest.advanceTimersByTime(250); expect(first.disconnect).toHaveBeenCalledTimes(1); expect(next.connect).toHaveBeenCalled();
    const second = a.createAnalyser.mock.results[1].value; a.meterTap.mockReturnValue(null);
    jest.advanceTimersByTime(250); expect(second.disconnect).toHaveBeenCalledTimes(1); expect(read).toHaveBeenLastCalledWith(-60);
    stop(); expect(jest.getTimerCount()).toBe(0);
});
test('missing analyser or absent audio falls back to silence', () => {
    const read = jest.fn(); const a = fakeAudio(); delete (a.audio.context as Record<string, unknown>).createAnalyser;
    const one = subscribeMeter(a.audio, 't1', false, read), two = subscribeMeter(null, 'master', false, read);
    expect(read).toHaveBeenCalledWith(-60); one(); two();
});
