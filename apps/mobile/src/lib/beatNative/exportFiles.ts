import { randomUUID } from 'expo-crypto';
import { Directory, File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { ExportFailure } from './exportFailure';

const root = () => new Directory(Paths.cache, 'veyrnox-beat-export');
const active = new Set<string>();
const pendingRemoval = new Set<string>();
let cacheGeneration = 0;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const remove = (dir: Directory) => { try { dir.delete(); } catch { /* Cache cleanup is best effort. */ } };
/** Invalidate work waiting to stage; let an already-open system share finish using its attachment. */
export function clearBeatExports(): void {
    cacheGeneration++;
    for (const uri of active) pendingRemoval.add(uri);
    try {
        const base = root(), prefix = `${base.uri.replace(/\/$/, '')}/`;
        if (!base.exists) return;
        for (const entry of base.list()) {
            if (!(entry instanceof Directory) || active.has(entry.uri)) continue;
            const relative = entry.uri.startsWith(prefix) ? entry.uri.slice(prefix.length).replace(/\/$/, '') : '';
            if (uuid.test(relative)) remove(entry);
        }
    } catch { /* Cleanup must never block sign-out or owner adoption. */ }
}
export function sweepBeatExports() {
    try {
        const base = root(), prefix = `${base.uri.replace(/\/$/, '')}/`;
        if (!base.exists) return;
        for (const entry of base.list()) {
            if (!(entry instanceof Directory) || active.has(entry.uri)) continue;
            const relative = entry.uri.startsWith(prefix) ? entry.uri.slice(prefix.length).replace(/\/$/, '') : '';
            if (!uuid.test(relative)) continue;
            try {
                const info = entry.info();
                const times = [info.modificationTime, ...entry.list().map(file => file instanceof File ? file.modificationTime : null)]
                    .filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
                let age = times.length ? Math.max(...times) : info.creationTime;
                if (typeof age !== 'number') {
                    const marker = new File(entry, '.created').textSync();
                    age = /^\d+$/.test(marker) ? Number(marker) : undefined;
                }
                if (typeof age === 'number' && Date.now() - age > 24 * 60 * 60 * 1000) remove(entry);
            } catch { /* Skip inaccessible entries. */ }
        }
    } catch { /* A missing cache does not prevent a new attempt. */ }
}
/** filename is produced by the shared exportFilename; never reuse an earlier attempt directory. */
export async function shareBeatExport(bytes: ArrayBuffer, filename: string, current: () => boolean = () => true) {
    const generation = cacheGeneration;
    if (!current()) return;
    if (!await Sharing.isAvailableAsync()) throw new ExportFailure('beatExport.shareUnavailable');
    if (generation !== cacheGeneration) throw new ExportFailure('beatExport.signIn');
    if (!current()) return;
    sweepBeatExports();
    const attempt = new Directory(root(), randomUUID());
    let created = false, handedOver = false;
    active.add(attempt.uri);
    try {
        attempt.create({ intermediates: true }); created = true;
        const marker = new File(attempt, '.created'); marker.create(); marker.writeSync(String(Date.now()));
        if (!/^[a-zA-Z0-9 _-]+\.wav$/.test(filename)) throw new Error('invalid_filename');
        const file = new File(attempt, filename); file.create(); file.writeSync(new Uint8Array(bytes));
        if (!current()) return;
        handedOver = true;
        await Sharing.shareAsync(file.uri, { mimeType: 'audio/wav', UTI: 'com.microsoft.waveform-audio' });
    } catch { throw new ExportFailure('beatExport.shareError'); }
    finally {
        active.delete(attempt.uri);
        if (created && (!handedOver || pendingRemoval.has(attempt.uri))) remove(attempt);
        pendingRemoval.delete(attempt.uri);
    }
}
