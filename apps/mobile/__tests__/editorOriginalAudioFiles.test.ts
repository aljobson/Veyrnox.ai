import { ensureOriginalAudioFile, createAudition } from '../src/lib/editorOriginalAudioFiles';
const mockFiles = new Map<string, number>();
const mockWrite = jest.fn();
const mockPlayers: any[] = [];
jest.mock('expo-file-system', () => ({
    Paths: { cache: 'cache' }, Directory: class { uri = 'cache/original'; create() {} },
    File: class {
        uri: string;
        constructor(_dir: unknown, name: string) { this.uri = name; }
        get exists() { return mockFiles.has(this.uri); }
        get size() { return mockFiles.get(this.uri) ?? 0; }
        create() { mockFiles.set(this.uri, 0); }
        async write(bytes: Uint8Array) { mockWrite(); mockFiles.set(this.uri, bytes.length); }
        delete() { mockFiles.delete(this.uri); }
    },
}));
jest.mock('expo-audio', () => ({ setAudioModeAsync: jest.fn(async () => {}), createAudioPlayer: jest.fn(() => {
    const p = { play: jest.fn(), remove: jest.fn(), addListener: jest.fn((_event, callback) => { p.finish = callback; return { remove: jest.fn() }; }), finish: (_s: any) => {} };
    mockPlayers.push(p); return p;
}) }));
beforeEach(() => { mockFiles.clear(); mockWrite.mockReset(); mockPlayers.length = 0; });
test('reuses correct file, rewrites short file, deletes failed partial write', async () => {
    const uri = await ensureOriginalAudioFile('tap-click'); await ensureOriginalAudioFile('tap-click');
    expect(mockWrite).toHaveBeenCalledTimes(1); mockFiles.set(uri, 1);
    await ensureOriginalAudioFile('tap-click'); expect(mockWrite).toHaveBeenCalledTimes(2);
    mockFiles.set(uri, 1); mockWrite.mockImplementationOnce(() => { throw new Error('disk'); });
    await expect(ensureOriginalAudioFile('tap-click')).rejects.toThrow('disk'); expect(mockFiles.has(uri)).toBe(false);
});
test('audition replaces, stops on finish, and releases the player', async () => {
    const changed = jest.fn(), audition = createAudition(changed);
    await audition.play('first'); await audition.play('second');
    expect(mockPlayers[0].remove).toHaveBeenCalledTimes(1);
    mockPlayers[1].finish({ didJustFinish: true }); expect(mockPlayers[1].remove).toHaveBeenCalledTimes(1);
    expect(changed).toHaveBeenLastCalledWith(false);
    await audition.play('third'); audition.release(); expect(mockPlayers[2].remove).toHaveBeenCalledTimes(1);
});
