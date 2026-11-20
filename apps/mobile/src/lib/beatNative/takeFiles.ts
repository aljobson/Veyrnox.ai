import { Directory, File, Paths } from 'expo-file-system';
import type { AudioTake, BeatTakeStorage, TakeChunk, TakeRow } from './takeShared';

export interface TakeFileIO {
    list(): Promise<string[]>;
    read(name: string): Promise<Uint8Array | null>;
    write(name: string, bytes: Uint8Array): Promise<void>;
    remove?(name: string): Promise<void>;
    move(from: string, to: string): Promise<void>;
}
const validId = (id: string) => {
    if (!/^[a-zA-Z0-9_-]{1,128}$/.test(id)) throw new Error('invalid_take_id');
    return id;
};
const validName = (name: string) => {
    if (!/^[a-zA-Z0-9_-]+(?:\.[a-zA-Z0-9_-]+)*$/.test(name) || name.length > 256) throw new Error('invalid_take_filename');
    return name;
};
export function nativeTakeIO(): TakeFileIO {
    const root = () => { const dir = new Directory(Paths.document, 'beat-takes'); dir.create({ intermediates: true, idempotent: true }); return dir; };
    const file = (name: string) => new File(root(), validName(name));
    return {
        async list() { return root().list().filter(e => e instanceof File).map(e => e.name); },
        async read(name) { const f = file(name); return f.exists ? f.bytes() : null; },
        async write(name, bytes) { file(name).write(bytes); },
        async remove(name) { const f = file(name); if (f.exists) f.delete(); },
        async move(from, to) { file(from).move(file(to), { overwrite: true }); },
    };
}
export const jsonBytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value));
export const parseBytes = (bytes: Uint8Array) => JSON.parse(new TextDecoder().decode(bytes));
// One queue per adapter serializes promotion with replacement, including startup reads.
export function createTakeFiles(io: TakeFileIO = nativeTakeIO()): BeatTakeStorage {
    let pending = Promise.resolve<unknown>(undefined);
    const serial = <T>(work: () => Promise<T>): Promise<T> => {
        const next = pending.catch(() => undefined).then(work); pending = next; return next;
    };
    let initialized = false;
    async function promote() {
        if (initialized) return;
        for (const name of await io.list()) {
            try { validName(name); } catch { continue; }
            if (name.endsWith('.tmp')) await io.remove?.(name);
            else if (name.endsWith('.pending')) await io.move(name, name.slice(0, -8));
        }
        if (io.remove) {
            const names = await io.list(), used = new Set<string>(), damaged = new Set<string>();
            for (const name of names.filter(n => /\.(whole|chunk\.\d+)\.json$/.test(n))) {
                const stem = name.slice(0, -5), bytes = await io.read(name);
                try { if (bytes) used.add(audioName(stem, parseBytes(bytes).audioVersion)); }
                catch { damaged.add(stem); } // Preserve audio belonging to an unreadable manifest.
            }
            for (const name of names) {
                const match = /^(.*\.(?:whole|chunk\.\d+))\.[a-f0-9-]{36}\.f32$/.exec(name);
                if (match && !damaged.has(match[1]) && !used.has(name)) await io.remove(name);
            }
        }
        initialized = true;
    }
    const audioName = (stem: string, version: unknown) => {
        if (typeof version !== 'string' || !/^[a-f0-9-]{36}$/.test(version)) throw new Error('invalid_audio_version');
        return `${stem}.${version}.f32`;
    };
    async function publish(name: string, bytes: Uint8Array, check: () => void) {
        validName(name); check();
        await io.write(name + '.tmp', bytes);
        check(); await io.move(name + '.tmp', name + '.pending');
        await io.move(name + '.pending', name);
    }
    async function readRow(name: string): Promise<TakeRow | null> {
        const bytes = await io.read(name);
        if (!bytes) return null;
        try {
            const row = parseBytes(bytes) as TakeRow;
            validId(row.id);
            if (!(row.sampleRate > 0 && Number.isSafeInteger(row.length) && row.length > 0 && row.length * 4 <= 1_000_000_000)) return null;
            return row;
        } catch { return null; }
    }
    async function writeAudio(row: AudioTake | TakeChunk, stem: string, check: () => void) {
        if (!(row.samples instanceof Float32Array) || !row.samples.length || row.samples.byteLength > 1_000_000_000) throw new Error('invalid_take_audio');
        const bytes = new Uint8Array(row.samples.length * 4), view = new DataView(bytes.buffer);
        row.samples.forEach((v, i) => view.setFloat32(i * 4, v, true));
        const { samples, ...meta } = row;
        const previousBytes = await io.read(stem + '.json');
        const previous = previousBytes ? parseBytes(previousBytes).audioVersion : null;
        const audioVersion = crypto.randomUUID();
        // Audio must be durable before publishing its manifest. A previous manifest stays usable
        // if a new write dies before .pending; incomplete .tmp files are never promoted.
        await publish(audioName(stem, audioVersion), bytes, check);
        await publish(stem + '.json', jsonBytes({ ...meta, length: samples.length, audioVersion }), check);
        if (previous) await io.remove?.(audioName(stem, previous));
        return true;
    }
    async function readAudio(stem: string): Promise<AudioTake | null> {
        const bytes = await io.read(stem + '.json'); if (!bytes) return null;
        const meta = parseBytes(bytes) as AudioTake & { audioVersion: string };
        if (!Number.isSafeInteger(meta.length) || meta.length <= 0 || meta.length * 4 > 1_000_000_000 || !(meta.sampleRate > 0)) throw new Error('invalid_take_metadata');
        const raw = await io.read(audioName(stem, meta.audioVersion));
        if (!raw || raw.length % 4 || raw.length < meta.length * 4) throw new Error('invalid_take_audio');
        const view = new DataView(raw.buffer, raw.byteOffset, raw.byteLength), samples = new Float32Array(meta.length);
        for (let i = 0; i < samples.length; i++) samples[i] = view.getFloat32(i * 4, true);
        return { ...meta, samples };
    }
    return {
        listState: () => serial(async () => {
            await promote(); const rows = new Map<string, TakeRow>(); const names = await io.list();
            // Manifests close the gap between publishing audio and the shared store's putState.
            for (const name of names.filter(n => /\.(whole|chunk\.\d+)\.json$/.test(n))) {
                const bytes = await io.read(name); if (!bytes) continue;
                try {
                    const row = parseBytes(bytes) as TakeChunk;
                    const id = validId(row.takeId ?? row.id), length = (row.offset ?? 0) + row.length;
                    if (!(row.sampleRate > 0 && Number.isSafeInteger(length) && length > 0 && length * 4 <= 1_000_000_000)) continue;
                    if (name !== `${id}.${row.takeId ? `chunk.${row.offset}` : 'whole'}.json`) continue;
                    audioName(name.slice(0, -5), (row as TakeChunk & { audioVersion: string }).audioVersion);
                    if (length > (rows.get(id)?.length ?? 0)) rows.set(id, { ...row, id, length });
                } catch { /* A damaged take must not prevent loading the other takes. */ }
            }
            for (const name of names.filter(n => n.endsWith('.state.json'))) {
                const row = await readRow(name);
                if (row && name === `${row.id}.state.json`) rows.set(row.id, { ...row, length: Math.max(row.length, rows.get(row.id)?.length ?? 0) });
            }
            return [...rows.values()];
        }),
        putState: (row, check = () => {}) => serial(async () => { await promote(); await publish(`${validId(row.id)}.state.json`, jsonBytes(row), check); return true; }),
        get: id => serial(async () => { await promote(); return readAudio(`${validId(id)}.whole`); }),
        put: (row, check = () => {}) => serial(async () => { await promote(); return writeAudio(row, `${validId(row.id)}.whole`, check); }),
        listChunksFor: id => serial(async () => {
            validId(id); await promote(); const rows: TakeChunk[] = [];
            for (const name of await io.list()) if (name.startsWith(`${id}.chunk.`) && /^\d+\.json$/.test(name.slice(`${id}.chunk.`.length))) {
                const row = await readAudio(name.slice(0, -5)) as TakeChunk | null;
                if (row && row.takeId === id && Number.isSafeInteger(row.offset) && row.offset >= 0) rows.push(row);
            }
            return rows.sort((a, b) => a.offset - b.offset);
        }),
        putChunk: (row, check = () => {}) => serial(async () => {
            const id = validId(row.takeId);
            if (!Number.isSafeInteger(row.offset) || row.offset < 0 || row.id !== `${id}:${row.offset}`) throw new Error('invalid_chunk');
            await promote(); return writeAudio(row, `${id}.chunk.${row.offset}`, check);
        }),
    };
}
