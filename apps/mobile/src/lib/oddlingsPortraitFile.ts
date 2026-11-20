// The cast portrait as bytes on the phone: downloaded once into the cache, then read from there. Used by the moving
// native preview.
import { Directory, File, Paths } from 'expo-file-system';
import { findOddling, portraitUrl } from './oddlings';
import { isWebp, PORTRAIT_BYTES_MAX } from './oddlingsPuppet';

const folder = () => new Directory(Paths.cache, 'veyrnox-oddlings');

export async function portraitBytesFor(id: string): Promise<Uint8Array | null> {
    if (!findOddling(id)) return null;
    const dir = folder();
    if (!dir.exists) dir.create({ intermediates: true, idempotent: true });
    const file = new File(dir, `portrait-${id}.webp`);
    if (!file.exists) await File.downloadFileAsync(portraitUrl(id), file, { idempotent: true });
    if (file.size > PORTRAIT_BYTES_MAX) { file.delete(); return null; }
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (isWebp(bytes)) return bytes;
    // A half-written or wrong file is removed so the next try starts clean.
    if (file.exists) file.delete();
    return null;
}
