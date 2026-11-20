import { Directory, File, Paths } from 'expo-file-system';
import { validRecord, type BeatRecord } from './rules';

export interface BeatFiles {
    read(name: string): Promise<string | null>;
    /** Replace a complete file. Implementations must serialize replacements for a name. */
    write(name: string, text: string): Promise<void>;
    remove(name: string): Promise<void>;
    list(): Promise<string[]>;
}

/** Expo overwrite is delete+move on iOS. A completed .pending file closes that recovery gap.
 * .tmp is never read: a killed write may have left partial text. No existing record is deleted
 * until the complete new text has moved to .pending. Startup promotes pending writes first.
 */
export function documentFiles(): BeatFiles {
    const root = () => { const dir = new Directory(Paths.document, 'beats'); dir.create({ intermediates: true, idempotent: true }); return dir; };
    const file = (name: string) => {
        if (!/^[a-zA-Z0-9_.-]+$/.test(name)) throw new Error('invalid_filename');
        return new File(root(), name);
    };
    return {
        async read(name) { const f = file(name); return f.exists ? f.text() : null; },
        async write(name, text) {
            const temp = file(`${name}.tmp`);
            await temp.write(text);
            const pending = file(`${name}.pending`);
            await temp.move(pending, { overwrite: true });
            await pending.move(file(name), { overwrite: true });
        },
        async remove(name) {
            for (const suffix of ['.pending', '', '.tmp']) { const f = file(name + suffix); if (f.exists) f.delete(); }
        },
        async list() {
            const dir = root();
            for (const entry of dir.list()) {
                if (entry instanceof File && entry.name.endsWith('.pending')) {
                    await entry.move(file(entry.name.slice(0, -8)), { overwrite: true });
                }
            }
            return dir.list().filter(entry => entry instanceof File).map(entry => entry.name);
        },
    };
}
export const beatFile = (id: string) => `${id}.json`;
export async function loadRecords(files: BeatFiles): Promise<BeatRecord[]> {
    const records: BeatRecord[] = [];
    for (const name of await files.list()) {
        if (!/^[a-zA-Z0-9_.-]+\.json$/.test(name)) continue;
        // Read failures are not evidence of corrupt data; leave the original alone.
        let raw: string | null;
        try { raw = await files.read(name); } catch { continue; }
        if (raw === null) continue;
        let record: unknown;
        try { record = JSON.parse(raw); } catch { record = null; }
        if (validRecord(record) && name === beatFile(record.id)) { records.push(record); continue; }
        // Adapter has no rename primitive: copy completely before removing the invalid original.
        try {
            let bad = `${name}.bad`, n = 0;
            while (await files.read(bad) !== null) bad = `${name}.${++n}.bad`;
            await files.write(bad, raw);
            await files.remove(name);
        } catch { /* Preserve the unreadable/unquarantined source and load the remaining beats. */ }
    }
    return records;
}
