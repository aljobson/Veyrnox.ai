// Exercise the production adapter protocol, including interruption after Expo's destination removal.
const mockDisk = new Map<string, string>();
let mockCrash = false;
jest.mock('expo-file-system', () => {
    class Directory {
        uri: string;
        constructor(...parts: any[]) { this.uri = parts.map(p => p.uri ?? p).join('/'); }
        create() {}
        list() { return [...mockDisk.keys()].filter(p => p.startsWith(this.uri + '/')).map(p => new File(p)); }
    }
    class File {
        uri: string;
        constructor(...parts: any[]) { this.uri = parts.map(p => p.uri ?? p).join('/'); }
        get name() { return this.uri.split('/').at(-1)!; }
        get exists() { return mockDisk.has(this.uri); }
        async text() { return mockDisk.get(this.uri)!; }
        async write(text: string) { mockDisk.set(this.uri, text); }
        delete() { mockDisk.delete(this.uri); }
        async move(destination: File) {
            mockDisk.delete(destination.uri);
            if (mockCrash && this.name.endsWith('.pending')) { mockCrash = false; throw new Error('process_killed'); }
            mockDisk.set(destination.uri, mockDisk.get(this.uri)!); mockDisk.delete(this.uri); this.uri = destination.uri;
        }
    }
    return { File, Directory, Paths: { document: 'documents' } };
});
import { documentFiles } from '../src/lib/beatNative/persist';
import { createBeatStore } from '../src/lib/beatNative/store';
import { setTempo } from '../src/lib/beatNative/doc';
beforeEach(() => { mockDisk.clear(); mockCrash = false; jest.useFakeTimers(); });
afterEach(() => jest.useRealTimers());
test('completed temp recovers after interrupted overwrite; partial temp never replaces a saved beat', async () => {
    const store = createBeatStore(documentFiles()), doc = store.newBeat('Recover');
    await store.flushBeats(); store.putBeat(setTempo(doc, 140)); mockCrash = true;
    await expect(store.flushBeats()).rejects.toThrow('process_killed');
    expect([...mockDisk.keys()].some(p => p.endsWith('.pending'))).toBe(true);
    mockDisk.set(`documents/beats/${doc.id}.json.tmp`, '{partial');
    const relaunched = createBeatStore(documentFiles()); await relaunched.hydrateBeats();
    expect(relaunched.getBeat(doc.id)?.tempo.bpm).toBe(140);
    expect([...mockDisk.keys()].filter(p => p.endsWith('.json'))).toHaveLength(1);
});
