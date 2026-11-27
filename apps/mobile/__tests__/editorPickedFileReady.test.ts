import { waitForEditorPickedFile } from '../src/lib/editorPickedFileReady';

const readable = (state: { exists: boolean; size: number; bytes?: number; throws?: boolean }) => ({
    get exists() { return state.exists; },
    get size() { return state.size; },
    open() {
        if (state.throws) throw new Error('provider-not-ready');
        return { readBytes: async () => new Uint8Array(state.bytes ?? 1), close: jest.fn() };
    },
});

test('waits for an iCloud placeholder to become a readable non-empty cache file', async () => {
    let clock = 0, attempts = 0;
    const state = { exists: false, size: 0, bytes: 0 };
    const result = await waitForEditorPickedFile('file:///cache/iCloud.mov', {
        now: () => clock,
        pollMs: 10,
        sleep: async milliseconds => { clock += milliseconds; attempts++; if (attempts === 2) Object.assign(state, { exists: true, size: 400, bytes: 1 }); },
        file: () => readable(state),
    });
    expect(result).toBe('ready');
    expect(attempts).toBe(2);
});

test('does not accept a non-empty provider placeholder until its bytes are readable', async () => {
    let clock = 0, attempts = 0;
    const state = { exists: true, size: 400, bytes: 1, throws: true };
    expect(await waitForEditorPickedFile('file:///cache/provider.mp4', {
        now: () => clock,
        pollMs: 10,
        sleep: async milliseconds => { clock += milliseconds; attempts++; state.throws = false; },
        file: () => readable(state),
    })).toBe('ready');
    expect(attempts).toBe(1);
});

test('returns unavailable after its bounded wait and cancelled when the editor session changes', async () => {
    let clock = 0;
    expect(await waitForEditorPickedFile('file:///cache/missing.mp4', {
        timeoutMs: 25,
        pollMs: 10,
        now: () => clock,
        sleep: async milliseconds => { clock += milliseconds; },
        file: () => readable({ exists: false, size: 0 }),
    })).toBe('unavailable');

    let live = true;
    expect(await waitForEditorPickedFile('file:///cache/old-project.mp4', {
        live: () => live,
        sleep: async () => { live = false; },
        file: () => readable({ exists: false, size: 0 }),
    })).toBe('cancelled');
});
