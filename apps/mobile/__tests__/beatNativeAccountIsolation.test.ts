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
