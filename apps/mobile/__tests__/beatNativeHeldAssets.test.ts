import { createNativeHeldAssets, nativeHeldError, recordNativeHeldError } from '../src/lib/beatNative/nativeHeldAssets';

const song = (jobId = '33333333-3333-4333-8333-333333333333') => ({ source: 'song' as const,
    ref: { songId: '11111111-1111-4111-8111-111111111111', versionId: '22222222-2222-4222-8222-222222222222', jobId } });
const target = (kind: 'target' | 'residual') => ({ source: 'target' as const,
    ref: { songId: '11111111-1111-4111-8111-111111111111', versionId: '22222222-2222-4222-8222-222222222222',
        requestId: '44444444-4444-4444-8444-444444444444', kind, instrument: 'vocals' } });

test('held state follows signing aliases while target outputs remain independent', () => {
    const store = createNativeHeldAssets();
    store.markHeld(song());
    expect(store.state(song()).status).toBe('held');
    expect(store.isHeld({ ...song(), ref: { ...song().ref } })).toBe(true);
    store.markHeld(target('target'));
    expect(store.isHeld(target('target'))).toBe(true);
    expect(store.isHeld(target('residual'))).toBe(false);
    expect(store.state({ source: 'sound', ref: 'sub-one' }).status).toBe('ready');
});

test('retry clears one identity or the editor store, reset is account-wide, and stores are isolated', () => {
    const first = createNativeHeldAssets(), second = createNativeHeldAssets();
    first.markHeld(song()); first.markHeld(target('target'));
    expect(() => first.assertAvailable(song())).toThrow('Held for review');
    first.retry(song()); expect(first.isHeld(song())).toBe(false); expect(first.isHeld(target('target'))).toBe(true);
    first.retry(); expect(first.isHeld(target('target'))).toBe(false);
    second.markHeld(song()); first.reset(); expect(second.isHeld(song())).toBe(true);
});

test('only the shared held envelope mutates state and the public error is stable', () => {
    const store = createNativeHeldAssets(), asset = song();
    expect(recordNativeHeldError(store, asset, new Error('404 text is not authority'))).toBe(false);
    expect(recordNativeHeldError(store, asset, { status: 404, body: { error: 'held' } })).toBe(true);
    expect(store.isHeld(asset)).toBe(true);
    expect(nativeHeldError()).toMatchObject({ status: 404, code: 'held' });
});
