// An in-memory stand-in for expo-file-system, for tests that follow real paths across accounts.
export const mockDisk = new Map<string, Uint8Array>();
export const diskFaults: { write?: (uri: string) => boolean; move?: (uri: string) => boolean; read?: (uri: string) => boolean; remove?: (uri: string) => boolean } = {};
export function expoFileSystem() {
    class Directory {
        uri: string;
        constructor(...parts: any[]) { this.uri = parts.map(p => p.uri ?? p).join('/'); }
        get exists() { return [...mockDisk.keys()].some(p => p.startsWith(this.uri + '/')); }
        create() {}
        delete() { for (const p of [...mockDisk.keys()]) if (p.startsWith(this.uri + '/')) mockDisk.delete(p); }
        list() { return [...mockDisk.keys()].filter(p => p.startsWith(this.uri + '/') && !p.slice(this.uri.length + 1).includes('/')).map(p => new File(p)); }
    }
    class File {
        uri: string;
        constructor(...parts: any[]) { this.uri = parts.map(p => p.uri ?? p).join('/'); }
        get name() { return this.uri.split('/').at(-1)!; }
        get exists() { return mockDisk.has(this.uri); }
        async text() { return new TextDecoder().decode(mockDisk.get(this.uri)!); }
        async bytes() { if (diskFaults.read?.(this.uri)) throw new Error('disk_failed'); return mockDisk.get(this.uri)!.slice(); }
        create() { mockDisk.set(this.uri, new Uint8Array()); }
        write(value: string | Uint8Array) {
            if (diskFaults.write?.(this.uri)) throw new Error('disk_failed');
            mockDisk.set(this.uri, typeof value === 'string' ? new TextEncoder().encode(value) : value.slice());
        }
        delete() { if (diskFaults.remove?.(this.uri)) throw new Error('disk_failed'); mockDisk.delete(this.uri); }
        move(destination: File) {
            if (diskFaults.move?.(destination.uri)) throw new Error('disk_failed');
            mockDisk.set(destination.uri, mockDisk.get(this.uri)!); mockDisk.delete(this.uri); this.uri = destination.uri;
        }
    }
    return { File, Directory, Paths: { document: 'documents', cache: 'cache' } };
}
