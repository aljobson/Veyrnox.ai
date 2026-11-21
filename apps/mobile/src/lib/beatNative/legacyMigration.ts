import type { BeatDoc } from './doc';
import { accountBeatFiles, beatFile, documentFiles, type AccountBeatFiles, type BeatFiles } from './persist';
import { takeAssets, validRecord, type BeatRecord } from './rules';
import { jsonBytes, legacyTakeIO, nativeTakeIO, parseBytes, type TakeFileIO } from './takeFiles';

// Beats saved before owner stamps sit directly under Documents/beats and Documents/beat-takes.
// A beat moves only to the account named in its own cloud link. A never-synced beat stays hidden.
// A take moves only with the account owning the beat it was recorded in. Anything uncertain stays hidden.
// Each step can be repeated: copy, publish the stamped beat, then remove originals nothing else still needs.

type Legacy = { rows: BeatRecord[]; unreadable: boolean };
const takeRefs = (doc: BeatDoc) => (takeAssets(doc) as { ref: string }[]).map(asset => asset.ref).filter(ref => /^[a-zA-Z0-9_-]{1,128}$/.test(ref));
const filesOf = (names: string[], ref: string) => names.filter(name => name.startsWith(`${ref}.`) && !name.endsWith('.tmp') && !name.endsWith('.pending'));
const copyOrder = (name: string) => name.endsWith('.f32') ? 0 : name.endsWith('.state.json') ? 2 : 1;

async function readLegacy(files: BeatFiles): Promise<Legacy> {
    const rows: BeatRecord[] = [];
    let unreadable = false;
    for (const name of await files.list()) {
        if (!/^[a-zA-Z0-9_.-]+\.json$/.test(name)) continue;
        try {
            const raw = await files.read(name), record: unknown = raw ? JSON.parse(raw) : null;
            if (validRecord(record) && name === beatFile(record.id)) rows.push(record); else unreadable = true;
        } catch { unreadable = true; }
    }
    return { rows, unreadable };
}
async function legacyTakeNames(io: TakeFileIO) {
    for (const name of await io.list()) if (name.endsWith('.pending')) await io.move(name, name.slice(0, -8));
    return io.list();
}
/** The one beat this take was recorded in, or null when its manifests are damaged or disagree. */
async function originOf(io: TakeFileIO, names: string[]): Promise<string | null> {
    const origins = new Set<unknown>();
    for (const name of names.filter(item => item.endsWith('.json'))) {
        const bytes = await io.read(name);
        if (!bytes) return null;
        try { origins.add((parseBytes(bytes) as { beatId?: unknown }).beatId); } catch { return null; }
    }
    const [origin] = [...origins];
    return origins.size === 1 && typeof origin === 'string' ? origin : null;
}
async function copyTake(source: TakeFileIO, target: TakeFileIO, names: string[], owner: string) {
    const present = new Set(await target.list());
    for (const name of [...names].sort((a, b) => copyOrder(a) - copyOrder(b))) {
        if (present.has(name)) continue;
        const bytes = await source.read(name);
        if (!bytes) throw new Error('legacy_take_missing');
        await target.write(`${name}.tmp`, name.endsWith('.json') ? jsonBytes({ ...parseBytes(bytes), owner }) : bytes);
        await target.move(`${name}.tmp`, name);
    }
}
/** True when the existing account copy is this same saved version, so the original is safe to retire. */
async function sameVersion(files: BeatFiles, record: BeatRecord) {
    const raw = await files.read(beatFile(record.id));
    if (!raw) return false;
    const saved = JSON.parse(raw) as BeatRecord;
    return saved.revision === record.revision && saved.updatedAt === record.updatedAt;
}
async function migrate(owner: string): Promise<boolean> {
    const beats = documentFiles(), takes = legacyTakeIO();
    const { rows, unreadable } = await readLegacy(beats);
    const mine = rows.filter(record => record.cloud?.userId === owner);
    if (!mine.length) return true;
    const names = await legacyTakeNames(takes), target = documentFiles(owner), targetTakes = nativeTakeIO(owner);
    const accountNames = new Set(await target.list()), mineIds = new Set(mine.map(record => record.id));
    const copied = new Set<string>(), done = new Set<string>();
    let complete = true;
    for (const record of mine) {
        try {
            for (const ref of takeRefs(record.doc)) {
                const files = filesOf(names, ref);
                if (copied.has(ref) || !files.length) continue;
                const origin = await originOf(takes, files);
                if (!origin || !(mineIds.has(origin) || accountNames.has(beatFile(origin)))) continue;
                await copyTake(takes, targetTakes, files, owner);
                copied.add(ref);
            }
            if (!accountNames.has(beatFile(record.id))) {
                await target.write(beatFile(record.id), JSON.stringify({ ...record, owner }));
                accountNames.add(beatFile(record.id));
            } else if (!await sameVersion(target, record)) continue; // The account has newer work: keep the old copy hidden.
            done.add(record.id);
        } catch { complete = false; }
    }
    const stillUsed = new Set(rows.filter(record => !done.has(record.id)).flatMap(record => takeRefs(record.doc)));
    try {
        if (!unreadable) for (const ref of copied) if (!stillUsed.has(ref)) for (const name of filesOf(names, ref)) await takes.remove?.(name);
        for (const id of done) await beats.remove(beatFile(id));
    } catch { complete = false; }
    return complete;
}

let queue: Promise<unknown> = Promise.resolve();
const serial = <T>(work: () => Promise<T>) => { const next = queue.catch(() => undefined).then(work); queue = next; return next; };
const finished = new Set<string>(), running = new Map<string, Promise<void>>();

/** Never rejects. A failed move leaves the originals hidden, and the next sign-in tries again. */
export function startLegacyMigration(owner: string): Promise<void> {
    if (finished.has(owner)) return Promise.resolve();
    const active = running.get(owner);
    if (active) return active;
    const run = serial(() => migrate(owner)).then(ok => { if (ok) finished.add(owner); }, () => undefined).finally(() => { running.delete(owner); });
    running.set(owner, run);
    return run;
}
/** Account deletion: remove old beats linked to this account and takes recorded in them that nothing else uses. */
export function eraseLegacyOwner(owner: string): Promise<void> {
    return serial(async () => {
        const beats = documentFiles(), takes = legacyTakeIO();
        const { rows, unreadable } = await readLegacy(beats);
        const mine = rows.filter(record => record.cloud?.userId === owner);
        if (!mine.length) return;
        const names = await legacyTakeNames(takes), mineIds = new Set(mine.map(record => record.id));
        const stillUsed = new Set(rows.filter(record => !mineIds.has(record.id)).flatMap(record => takeRefs(record.doc)));
        if (!unreadable) for (const ref of new Set(mine.flatMap(record => takeRefs(record.doc)))) {
            const files = filesOf(names, ref), origin = await originOf(takes, files);
            if (!stillUsed.has(ref) && origin && mineIds.has(origin)) for (const name of files) await takes.remove?.(name);
        }
        for (const record of mine) await beats.remove(beatFile(record.id));
    });
}
const gatedBeats = (files: BeatFiles, ready: Promise<void>): BeatFiles => ({
    read: async name => { await ready; return files.read(name); },
    write: async (name, text) => { await ready; return files.write(name, text); },
    remove: async name => { await ready; return files.remove(name); },
    list: async () => { await ready; return files.list(); },
});
/** Account storage that waits for that account's old beats to arrive before its first read or write. */
export const migratedBeatFiles: AccountBeatFiles = {
    forOwner: owner => gatedBeats(accountBeatFiles.forOwner(owner), startLegacyMigration(owner)),
    erase: owner => accountBeatFiles.erase(owner),
};
export function migratedTakeIO(owner: string): TakeFileIO {
    const io = nativeTakeIO(owner), ready = startLegacyMigration(owner);
    return {
        list: async () => { await ready; return io.list(); },
        read: async name => { await ready; return io.read(name); },
        write: async (name, bytes) => { await ready; return io.write(name, bytes); },
        remove: async name => { await ready; return io.remove?.(name); },
        move: async (from, to) => { await ready; return io.move(from, to); },
    };
}
// For tests.
export function resetLegacyMigration() { finished.clear(); running.clear(); }
