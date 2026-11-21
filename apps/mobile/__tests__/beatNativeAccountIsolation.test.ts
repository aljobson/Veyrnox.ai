// Two accounts on one phone, through the real store, take storage and sign-out path over an in-memory disk.
const mockDisk = new Map<string, Uint8Array>();
jest.mock('expo-file-system', () => {
    const encode = (text: string) => new TextEncoder().encode(text);
    class Directory {
        uri: string;
        constructor(...parts: any[]) { this.uri = parts.map(p => p.uri ?? p).join('/'); }
        get exists() { return [...mockDisk.keys()].some(p => p.startsWith(this.uri + '/')); }
        create() {}
        delete() { for (const p of [...mockDisk.keys()]) if (p.startsWith(this.uri + '/')) mockDisk.delete(p); }
        list() {
            const direct = [...mockDisk.keys()].filter(p => p.startsWith(this.uri + '/') && !p.slice(this.uri.length + 1).includes('/'));
            return direct.map(p => new File(p));
        }
    }
    class File {
        uri: string;
        constructor(...parts: any[]) { this.uri = parts.map(p => p.uri ?? p).join('/'); }
        get name() { return this.uri.split('/').at(-1)!; }
        get exists() { return mockDisk.has(this.uri); }
        async text() { return new TextDecoder().decode(mockDisk.get(this.uri)!); }
        async bytes() { return mockDisk.get(this.uri)!.slice(); }
        create() { mockDisk.set(this.uri, new Uint8Array()); }
        write(value: string | Uint8Array) { mockDisk.set(this.uri, typeof value === 'string' ? encode(value) : value.slice()); }
        delete() { mockDisk.delete(this.uri); }
        move(destination: File) { mockDisk.set(destination.uri, mockDisk.get(this.uri)!); mockDisk.delete(this.uri); this.uri = destination.uri; }
    }
    return { File, Directory, Paths: { document: 'documents', cache: 'cache' } };
});
import { bindCacheUser, resetCacheUser, wipeCache } from '../src/lib/appCache';
import { beatStore } from '../src/lib/beatNative/store';
import { hydrateBeatTakes, loadBeatTake, pendingBeatTakes, putBeatTake } from '../src/lib/beatNative/takeShared';
import { setTempo } from '../src/lib/beatNative/doc';
import { eraseLocalBeats } from '../src/lib/beatNative/eraseLocal';
import { takeRow } from './beatNativeTakeFixtures';

const ALICE = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', BOB = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const signIn = (user: string) => bindCacheUser(user);
const signOut = () => wipeCache(undefined, undefined, 'signout');

beforeEach(async () => { await signOut(); resetCacheUser(); beatStore.resetBeats(); mockDisk.clear(); });

test('a second account cannot list, open or hear the first account\'s local beat and take', async () => {
    await signIn(ALICE); await beatStore.hydrateBeats();
    const beat = beatStore.newBeat('Alice private'), take = takeRow('alice-take', beat.id);
    await beatStore.flushBeats(); await putBeatTake(take);
    await signOut(); await signIn(BOB); await beatStore.hydrateBeats(); await hydrateBeatTakes();
    expect(beatStore.listBeats().map(doc => doc.title)).not.toContain('Alice private');
    expect(beatStore.getBeat(beat.id)).toBeUndefined();
    expect(pendingBeatTakes(beat.id)).toEqual([]);
    expect(await loadBeatTake(take.id)).toBeNull();
});

test('the first account gets its beat and recording back when it signs in again', async () => {
    await signIn(ALICE); await beatStore.hydrateBeats();
    const beat = beatStore.newBeat('Alice returns'), take = takeRow('alice-return', beat.id);
    await beatStore.flushBeats(); await putBeatTake(take);
    await signOut(); await signIn(BOB); await beatStore.hydrateBeats();
    await signOut(); await signIn(ALICE); await beatStore.hydrateBeats();
    expect(beatStore.getBeat(beat.id)?.title).toBe('Alice returns');
    expect(beatStore.getRecord(beat.id)?.owner).toBe(ALICE);
    expect((await loadBeatTake(take.id))?.samples).toEqual(take.samples);
});

test('an edit not yet saved at sign-out lands in its own account, never the next one', async () => {
    await signIn(ALICE); await beatStore.hydrateBeats();
    const beat = beatStore.newBeat('Unsaved'); await beatStore.flushBeats();
    beatStore.putBeat(setTempo(beat, 141));
    await signOut(); await signIn(BOB); await beatStore.hydrateBeats(); await beatStore.flushBeats();
    expect(beatStore.getBeat(beat.id)).toBeUndefined();
    expect([...mockDisk.keys()].some(path => path.includes(`accounts/${BOB}/${beat.id}`))).toBe(false);
    await signOut(); await signIn(ALICE); await beatStore.hydrateBeats();
    expect(beatStore.getBeat(beat.id)?.tempo.bpm).toBe(141);
});

test('a take write queued under one account is refused after the switch', async () => {
    await signIn(ALICE); await hydrateBeatTakes();
    const write = putBeatTake(takeRow('late-take', 'late-beat'));
    await signIn(BOB);
    await expect(write).rejects.toThrow('account_changed');
    expect([...mockDisk.keys()].some(path => path.includes(`accounts/${BOB}/late-take`))).toBe(false);
});

test('records from before owner stamps stay on disk and hidden from every account', async () => {
    await signIn(ALICE); await beatStore.hydrateBeats();
    const beat = beatStore.newBeat('Old'); await beatStore.flushBeats();
    const stamped = JSON.parse(new TextDecoder().decode(mockDisk.get(`documents/beats/accounts/${ALICE}/${beat.id}.json`)!));
    const { owner: _owner, ...legacy } = stamped, legacyPath = `documents/beats/${beat.id}.json`;
    mockDisk.delete(`documents/beats/accounts/${ALICE}/${beat.id}.json`);
    mockDisk.set(legacyPath, new TextEncoder().encode(JSON.stringify(legacy)));
    for (const user of [BOB, ALICE]) {
        await signOut(); await signIn(user); await beatStore.hydrateBeats();
        expect(beatStore.getBeat(beat.id)).toBeUndefined();
    }
    expect(mockDisk.has(legacyPath)).toBe(true);
});

test('account deletion erases that account and leaves the other account alone', async () => {
    await signIn(BOB); await beatStore.hydrateBeats();
    const kept = beatStore.newBeat('Bob keeps'), keptTake = takeRow('bob-take', kept.id);
    await beatStore.flushBeats(); await putBeatTake(keptTake);
    await signOut(); await signIn(ALICE); await beatStore.hydrateBeats();
    const beat = beatStore.newBeat('Alice leaves'); await beatStore.flushBeats(); await putBeatTake(takeRow('alice-gone', beat.id));
    beatStore.putBeat(setTempo(beat, 150));
    mockDisk.set(`documents/beat-ai/ai.${ALICE}.${beat.id}.parts`, new Uint8Array([1]));
    mockDisk.set(`documents/beat-ai/ai.${BOB}.${kept.id}.parts`, new Uint8Array([1]));
    await eraseLocalBeats(ALICE); await signOut();
    expect([...mockDisk.keys()].some(path => path.includes(ALICE))).toBe(false);
    expect(mockDisk.has(`documents/beat-ai/ai.${BOB}.${kept.id}.parts`)).toBe(true);
    await signIn(BOB); await beatStore.hydrateBeats();
    expect(beatStore.getBeat(kept.id)?.title).toBe('Bob keeps');
    expect((await loadBeatTake(keptTake.id))?.samples).toEqual(keptTake.samples);
});

test('the save check reads the signed-in account only', async () => {
    await signIn(ALICE); await beatStore.hydrateBeats();
    const beat = beatStore.newBeat('Saved'); await beatStore.flushBeats();
    expect((await beatStore.readSavedDoc(beat.id))?.title).toBe('Saved');
    await signOut(); await signIn(BOB); await beatStore.hydrateBeats();
    expect(await beatStore.readSavedDoc(beat.id)).toBeUndefined();
});
