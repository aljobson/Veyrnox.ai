import type { BeatFiles } from '../beatNative/persist';
import { receiptFiles } from './files';
import { uuid } from './client';
// Non-.json suffix keeps the N2 document hydrator from treating these as beats.
export function namespace(owner: string, beatId: string, kind: string) {
    if (!uuid(owner) || !uuid(beatId) || !/^[a-z]+$/.test(kind)) throw new Error('invalid_namespace');
    return `ai.${owner}.${beatId}.${kind}`;
}
const queues = new Map<string, Promise<unknown>>();
export function serial<T>(name: string, work: () => Promise<T>): Promise<T> {
    const next = (queues.get(name) ?? Promise.resolve()).catch(() => undefined).then(work);
    queues.set(name, next);
    void next.finally(() => { if (queues.get(name) === next) queues.delete(name); }).catch(() => undefined);
    return next;
}
export function receiptStore<T extends { owner: string; beatId: string; key: string }>(kind: string, valid: (v: unknown) => v is T, files: BeatFiles = receiptFiles()) {
    async function read(owner: string, beatId: string): Promise<T[]> {
        const name = namespace(owner, beatId, kind);
        // Recover this namespace only; never enumerate/read another account's receipts.
        const pending = await files.read(`${name}.pending`);
        const raw = pending ?? await files.read(name);
        if (raw === null) return [];
        const rows: unknown = JSON.parse(raw);
        if (!Array.isArray(rows) || rows.length > 8 || !rows.every(v => valid(v) && v.owner === owner && v.beatId === beatId)) throw new Error('invalid_receipts');
        return rows as T[];
    }
    return {
        read,
        put: (row: T, current = () => true) => serial(namespace(row.owner, row.beatId, kind), async () => {
            if (!valid(row)) throw new Error('invalid_receipt');
            const rows = (await read(row.owner, row.beatId)).filter(r => r.key !== row.key);
            if (!current()) return;
            if (rows.length >= 8) throw new Error('pending_limit');
            await files.write(namespace(row.owner, row.beatId, kind), JSON.stringify([...rows, row]));
        }),
        retire: (row: T, current = () => true) => serial(namespace(row.owner, row.beatId, kind), async () => {
            const rows = await read(row.owner, row.beatId);
            if (!current()) return;
            await files.write(namespace(row.owner, row.beatId, kind), JSON.stringify(rows.filter(r => r.key !== row.key)));
        }),
    };
}
