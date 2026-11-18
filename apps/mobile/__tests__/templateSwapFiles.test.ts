const mockFiles = new Map<string, { bytes: Uint8Array; modified: number }>();
jest.mock('expo-crypto', () => { let n = 0; return { randomUUID: () => String(++n) }; });
jest.mock('expo-file-system', () => {
    class File {
        uri: string;
        constructor(root: string | { uri: string }, name?: string) { const base = typeof root === 'string' ? root : root.uri; this.uri = base + (name ? (base.endsWith('/') ? '' : '/') + name : ''); }
        get exists() { return mockFiles.has(this.uri); }
        get modificationTime() { return mockFiles.get(this.uri)?.modified; }
        write(bytes: Uint8Array) { mockFiles.set(this.uri, { bytes, modified: Date.now() }); }
        delete() { mockFiles.delete(this.uri); }
    }
    class Directory {
        uri: string;
        constructor(root: { uri: string }, name: string) { this.uri = root.uri + name + '/'; }
        exists = true;
        create() {}
        list() { return [...mockFiles.keys()].filter(uri => uri.startsWith(this.uri)).map(uri => new File(uri)); }
    }
    return { File, Directory, Paths: { cache: { uri: 'file://cache/' } } };
});
import { writeSwapPng, deleteSwapFile, cleanOldSwapFiles } from '../src/lib/templateSwap/files';
test('only swap cache files are written and reclaimed, with 24-hour launch cleanup', () => {
    const bytes = new Uint8Array([137, 80, 78, 71]), file = writeSwapPng(bytes, { width: 500, height: 600 });
    expect(mockFiles.get(file.uri)?.bytes).toBe(bytes); expect(file.type).toBe('image/png');
    mockFiles.set('file://original.png', { bytes, modified: 0 }); deleteSwapFile('file://original.png'); expect(mockFiles.has('file://original.png')).toBe(true);
    mockFiles.set('file://cache/template-swap/old.png', { bytes, modified: Date.now() - 86_400_001 });
    cleanOldSwapFiles(); expect(mockFiles.has(file.uri)).toBe(true); expect(mockFiles.has('file://cache/template-swap/old.png')).toBe(false);
    deleteSwapFile(file.uri); expect(mockFiles.has(file.uri)).toBe(false);
});
