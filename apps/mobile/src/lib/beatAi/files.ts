import { Directory, File, Paths } from 'expo-file-system';
import type { BeatFiles } from '../beatNative/persist';
/** N2's completed-pending-file protocol, in a separate directory. N2 hydration
 * must not enumerate/promote another owner's AI receipts. Reads recover only
 * the explicitly requested owner namespace; storage.ts serializes replacements.
 */
/** Account deletion only: receipts are named `ai.<owner>.<beat>.<kind>`, so only that owner's files match. */
export function eraseAccountReceipts(owner: string) {
    if (!/^[a-zA-Z0-9-]{1,128}$/.test(owner)) throw new Error('invalid_owner');
    const directory = new Directory(Paths.document, 'beat-ai');
    if (!directory.exists) return;
    for (const entry of directory.list()) if (entry instanceof File && entry.name.startsWith(`ai.${owner}.`)) entry.delete();
}
export function receiptFiles(): BeatFiles {
    const file = (name: string) => {
        if (!/^[a-zA-Z0-9_.-]+$/.test(name)) throw new Error('invalid_filename');
        const directory = new Directory(Paths.document, 'beat-ai');
        directory.create({ intermediates: true, idempotent: true });
        return new File(directory, name);
    };
    return {
        async read(name) { const target = file(name); return target.exists ? target.text() : null; },
        async write(name, text) {
            const temporary = file(`${name}.tmp`), pending = file(`${name}.pending`);
            await temporary.write(text);
            await temporary.move(pending, { overwrite: true });
            await pending.move(file(name), { overwrite: true });
        },
        async remove(name) { for (const suffix of ['', '.pending', '.tmp']) { const target = file(name + suffix); if (target.exists) target.delete(); } },
        // Receipts are never discovered across accounts by listing the directory.
        async list() { return []; },
    };
}
