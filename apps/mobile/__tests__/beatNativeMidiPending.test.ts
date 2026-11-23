jest.mock('expo-crypto', () => ({
    CryptoDigestAlgorithm: { SHA256: 'SHA-256' },
    digestStringAsync: async (_algorithm: string, value: string) => require('node:crypto').createHash('sha256').update(value).digest('hex'),
}));
import { addInstrumentTrack } from '../src/lib/beatNative/midi';
import { beatFingerprint, createMidiPendingStore, MIDI_PENDING_MAX_BYTES, midiPendingFile, midiRevokedFile, type MidiTake } from '../src/lib/beatNative/midiPending';
import { fixedDoc, memoryFiles, USER } from './beatNativeFixtures';

const beat = () => addInstrumentTrack(fixedDoc(), { engine: 'voice', id: 'piano', preset: 'grand' });
const take = (doc = beat()): MidiTake => {
    const track = doc.tracks.find(item => item.kind === 'midi')! as any;
    return { instrument: track.instrument, name: track.name, trackId: track.id, startTick: 0, endLimit: 3840,
        snap: 0, notes: [{ start: 0, end: 240, pitch: 60, velocity: 100 }] };
};

test('prepared rows are owner/beat scoped, bounded, cloned and use a non-Beat filename', async () => {
    const files = memoryFiles(), doc = beat(), current = { value: true };
    const store = createMidiPendingStore(files, { owner: USER, beatId: doc.id, isCurrent: () => current.value });
    const baseFingerprint = await beatFingerprint(doc), expectedFingerprint = 'a'.repeat(64);
    const baseContentFingerprint = await beatFingerprint(doc, { excludeLiveMix: true }), expectedContentFingerprint = 'b'.repeat(64);
    const prepared = await store.prepare({ take: take(doc), baseFingerprint, expectedFingerprint, baseContentFingerprint,
        expectedContentFingerprint, target: { kind: 'existing', beatId: doc.id }, createdAt: 10 });
    prepared.take.notes[0].pitch = 99;
    expect((await store.read())!.take.notes[0].pitch).toBe(60);
    expect(files.data.has(midiPendingFile(doc.id))).toBe(true);
    expect(midiPendingFile(doc.id).endsWith('.json')).toBe(false);
    expect(new TextEncoder().encode(files.data.get(midiPendingFile(doc.id))!).byteLength).toBeLessThan(MIDI_PENDING_MAX_BYTES);
    current.value = false;
    await expect(store.read()).rejects.toMatchObject({ code: 'pending_take_stale' });
    await expect(store.remove()).rejects.toMatchObject({ code: 'pending_take_stale' });
});

test('fingerprints ignore volatile updatedAt but cover real mix/document changes', async () => {
    const doc = beat();
    expect(await beatFingerprint({ ...doc, updatedAt: doc.updatedAt + 999 })).toBe(await beatFingerprint(doc));
    expect(await beatFingerprint({ ...doc, tracks: doc.tracks.map((track, index) => index ? { ...track, gain: 0.25 } : track) })).not.toBe(await beatFingerprint(doc));
});

test('malformed, wrong-owner and oversized durable rows are refused', async () => {
    const files = memoryFiles(), doc = beat(), name = midiPendingFile(doc.id);
    const store = createMidiPendingStore(files, { owner: USER, beatId: doc.id });
    files.data.set(name, '{bad');
    await expect(store.read()).rejects.toMatchObject({ code: 'invalid_pending_take' });
    files.data.set(name, 'x'.repeat(MIDI_PENDING_MAX_BYTES + 1));
    await expect(store.read()).rejects.toMatchObject({ code: 'pending_take_too_large' });
    files.data.set(name, JSON.stringify({ version: 1, state: 'prepared', owner: 'other', beatId: doc.id }));
    await expect(store.read()).rejects.toMatchObject({ code: 'invalid_pending_take' });
});

test('security revoke uses the captured adapter without a current-generation fence and a retained tombstone is never recoverable', async () => {
    const files = memoryFiles(), doc = beat(), name = midiPendingFile(doc.id), store = createMidiPendingStore(files, { owner: USER, beatId: doc.id, isCurrent: () => false });
    jest.mocked(files.remove).mockRejectedValueOnce(new Error('disk_full'));
    await expect(store.revoke()).resolves.toBeUndefined();
    expect(JSON.parse(files.data.get(name)!)).toMatchObject({ state: 'revoked', owner: USER, beatId: doc.id });
    expect(JSON.parse(files.data.get(midiRevokedFile(doc.id))!)).toMatchObject({ state: 'revoked', owner: USER, beatId: doc.id });
    await expect(createMidiPendingStore(files, { owner: USER, beatId: doc.id }).read()).resolves.toBeNull();
});

test('a failed replacement prepare cannot clear quarantine and expose an older retained row', async () => {
    const files = memoryFiles(), doc = beat(), name = midiPendingFile(doc.id), marker = midiRevokedFile(doc.id);
    const store = createMidiPendingStore(files, { owner: USER, beatId: doc.id });
    const baseFingerprint = await beatFingerprint(doc), expectedFingerprint = 'a'.repeat(64);
    const baseContentFingerprint = await beatFingerprint(doc, { excludeLiveMix: true }), expectedContentFingerprint = 'b'.repeat(64);
    await store.prepare({ take: take(doc), baseFingerprint, expectedFingerprint, baseContentFingerprint,
        expectedContentFingerprint, target: { kind: 'existing', beatId: doc.id }, createdAt: 10 });
    jest.mocked(files.write).mockImplementation(async (filename, value) => {
        if (filename === name) throw new Error('primary_write_failed');
        files.data.set(filename, value);
    });
    jest.mocked(files.remove).mockImplementation(async filename => {
        if (filename === name) throw new Error('primary_remove_failed');
        files.data.delete(filename);
    });
    await expect(store.revoke()).resolves.toBeUndefined();
    expect(files.data.has(name)).toBe(true); expect(files.data.has(marker)).toBe(true);

    const replacement = createMidiPendingStore(files, { owner: USER, beatId: doc.id });
    await expect(replacement.prepare({ take: take(doc), baseFingerprint, expectedFingerprint: 'c'.repeat(64), baseContentFingerprint,
        expectedContentFingerprint: 'd'.repeat(64), target: { kind: 'existing', beatId: doc.id }, createdAt: 20 })).rejects.toThrow('primary_write_failed');
    expect(files.data.has(marker)).toBe(true);
    await expect(createMidiPendingStore(files, { owner: USER, beatId: doc.id }).read()).resolves.toBeNull();
});
