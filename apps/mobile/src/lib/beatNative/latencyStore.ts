import { Directory, File, Paths } from 'expo-file-system';
import { jsonBytes, parseBytes, type TakeFileIO } from './takeFiles';
import type { SyncStorage } from './takeShared';
const NAME = 'beat-latency.json';
export function createLatencyStorage(io: TakeFileIO) {
    const values = new Map<string, string>(), listeners = new Set<() => void>();
    let writing = Promise.resolve(), hydration: Promise<void> | undefined, version = 0;
    const emit = () => { version++; listeners.forEach(listener => listener()); };
    const persist = () => {
        writing = writing.catch(() => undefined).then(async () => {
            await hydrate();
            const bytes = jsonBytes(Object.fromEntries(values));
            await io.write(NAME + '.tmp', bytes); await io.move(NAME + '.tmp', NAME + '.pending'); await io.move(NAME + '.pending', NAME);
        });
        void writing.catch(() => undefined);
    };
    const facade: SyncStorage = { getItem: key => values.get(key) ?? null, setItem(key, value) { values.set(key, value); persist(); emit(); } };
    function hydrate(): Promise<void> {
        return hydration ??= (async () => {
            if ((await io.list()).includes(NAME + '.pending')) await io.move(NAME + '.pending', NAME);
            const bytes = await io.read(NAME);
            if (bytes) for (const [key, value] of Object.entries(parseBytes(bytes))) {
                if (typeof value !== 'string') continue;
                const current = values.get(key);
                if (current === undefined) values.set(key, value);
                else {
                    // Latency stores device rows inside one JSON value. Preserve newer in-memory
                    // measurements while retaining other devices from the hydrated file.
                    try { values.set(key, JSON.stringify({ ...JSON.parse(value), ...JSON.parse(current) })); }
                    catch { /* Keep the newer in-memory value if the old file is malformed. */ }
                }
            }
            emit();
        })().catch(error => { hydration = undefined; throw error; });
    }
    return { ...facade,
        snapshot: () => version,
        subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
        hydrate,
        flush: () => writing,
    };
}
let instance: ReturnType<typeof createLatencyStorage> | undefined;
export function latencyStorage() {
    return instance ??= createLatencyStorage({
        async list() { return new Directory(Paths.document).list().map(e => e.name); },
        async read(name) { const f = new File(Paths.document, name); return f.exists ? f.bytes() : null; },
        async write(name, bytes) { new File(Paths.document, name).write(bytes); },
        async move(from, to) { new File(Paths.document, from).move(new File(Paths.document, to), { overwrite: true }); },
    });
}
