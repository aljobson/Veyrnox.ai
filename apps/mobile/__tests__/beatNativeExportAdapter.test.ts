import { loadNativeOfflineContext, OfflineUnavailable, withWindowOfflineContext } from '../src/lib/beatNative/nativeContext';
import type { NativeOfflineCtor, AdapterReport } from '../src/lib/beatNative/nativeContext';
import { deferred, tick } from './beatNativeFixtures';
import { offlineFixture } from './beatNativeExportFixtures';
jest.mock('react-native-audio-api', () => ({ OfflineAudioContext: undefined }));
const report = (): AdapterReport => ({ gaps: [], latencyHint: 'offline' });
test('lazy loader reports a missing constructor honestly', () => { expect(loadNativeOfflineContext()).toBeNull(); });
test('offline provider spans awaits, wraps native nodes, and restores exact window properties', async () => {
    const { Context } = offlineFixture(), original = function () {}, scope = { window: { OfflineAudioContext: original } }, r = report();
    await withWindowOfflineContext(Context, r, async () => {
        await Promise.resolve();
        const ctx = new (scope.window.OfflineAudioContext as unknown as NativeOfflineCtor)(2, 32, 48000);
        const gain = (ctx.createGain as () => { connect(dest: object): unknown })();
        const destination = {}; expect(gain.connect(destination)).toBe(destination);
        (ctx.createDynamicsCompressor as () => unknown)();
        expect(await ctx.startRendering()).toMatchObject({ numberOfChannels: 2, length: 32 });
    }, scope);
    expect(scope.window).toEqual({ OfflineAudioContext: original });
    expect(r.gaps).toEqual(expect.arrayContaining(['dynamicsCompressor', 'connectReturnsVoid']));
});
test('mutex prevents overlapping globals, including when the first job rejects', async () => {
    const { Context } = offlineFixture(), gate = deferred(), order: string[] = [], scope = {};
    const first = withWindowOfflineContext(Context, report(), async () => { order.push('first'); await gate.promise; throw new Error('render'); }, scope);
    const rejection = expect(first).rejects.toThrow('render');
    const second = withWindowOfflineContext(Context, report(), async () => { order.push('second'); }, scope);
    await tick(); expect(order).toEqual(['first']); gate.resolve(); await rejection; await second;
    expect(order).toEqual(['first', 'second']); expect(scope).toEqual({});
});
test('null or throwing constructor is unavailable and always releases the override', async () => {
    const scope = {}, bad = function () { throw new Error('native missing'); } as unknown as NativeOfflineCtor;
    await expect(withWindowOfflineContext(null, report(), async () => {}, scope)).rejects.toBeInstanceOf(OfflineUnavailable);
    await expect(withWindowOfflineContext(bad, report(), async make => { make(1, 1, 48000); }, scope)).rejects.toBeInstanceOf(OfflineUnavailable);
    expect(scope).toEqual({});
    await expect(withWindowOfflineContext(offlineFixture().Context, report(), async () => 1, scope)).resolves.toBe(1);
});
