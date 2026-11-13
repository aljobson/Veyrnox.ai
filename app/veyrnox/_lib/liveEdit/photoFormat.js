// Bounded signature inspection. Extensions are picker hints, never trusted as file contents.
export const PHOTO_ACCEPT = 'image/jpeg,image/png,image/webp,image/avif,image/gif,image/bmp,image/heic,image/heif,.heic,.heif,.avif';
export const PHOTO_LIMITS = Object.freeze({ bytes: 50 * 1024 * 1024, pixels: 24_000_000, edge: 8192 });
const HEIF = new Set(['heic', 'heix', 'hevc', 'hevx', 'heim', 'heis', 'hevm', 'hevs', 'mif1', 'msf1']);
const HEIC = new Set(['heic', 'heix', 'hevc', 'hevx', 'heim', 'heis', 'hevm', 'hevs']);
const aliases = { 'image/jpg': 'image/jpeg', 'image/x-ms-bmp': 'image/bmp', 'image/heic-sequence': 'image/heic', 'image/heif-sequence': 'image/heif', 'image/avif-sequence': 'image/avif' };
export function validatePhotoDimensions(width, height) {
    if (!Number.isInteger(width) || !Number.isInteger(height) || Math.min(width, height) < 8 || Math.max(width, height) > PHOTO_LIMITS.edge || width * height > PHOTO_LIMITS.pixels) throw Error('photo-too-large');
}
// ISO/IEC 14496-12 'ftyp': size(4) 'ftyp' [largesize(8) when size===1] major(4) minor(4) compatible(4)*.
// The whole declared box is read (bounded) so the brand list is never judged from a partial view, and nothing outside
// the box is scanned. Size 0 (to end of file), boxes past the file, oversized lists and misaligned boxes are refused.
const FTYP_MAX = 64 * 1024;
async function ftypType(file, head) {
    const view = new DataView(head.buffer, head.byteOffset, head.byteLength);
    let size = view.getUint32(0), shift = 0;
    if (size === 1) {
        if (head.length < 16) throw Error('invalid-photo');
        const wide = view.getBigUint64(8);
        if (wide > BigInt(FTYP_MAX)) throw Error('invalid-photo');
        size = Number(wide); shift = 8;
    }
    if (size < 16 + shift || size % 4 || size > FTYP_MAX || size > file.size) throw Error('invalid-photo');
    const box = size <= head.length ? head : new Uint8Array(await file.slice(0, size).arrayBuffer());
    if (box.length < size) throw Error('invalid-photo');
    const brand = at => String.fromCharCode(...box.subarray(at, at + 4));
    const brands = [brand(8 + shift)];
    for (let i = 16 + shift; i + 4 <= size; i += 4) brands.push(brand(i));
    if (brands.some(v => v === 'avif' || v === 'avis')) return 'image/avif';
    if (brands.some(v => HEIF.has(v))) return brands.some(v => HEIC.has(v)) ? 'image/heic' : 'image/heif';
    return undefined;
}
export async function sniffPhotoType(file) {
    if (!file || !Number.isFinite(file.size) || file.size < 1 || typeof file.slice !== 'function') throw Error('invalid-photo');
    if (file.size > PHOTO_LIMITS.bytes) throw Error('photo-too-large');
    const b = new Uint8Array(await file.slice(0, 4096).arrayBuffer());
    const text = (start, end) => String.fromCharCode(...b.subarray(start, end));
    const starts = bytes => bytes.every((v, i) => b[i] === v);
    let type;
    if (starts([255, 216, 255])) type = 'image/jpeg';
    else if (starts([137, 80, 78, 71, 13, 10, 26, 10])) type = 'image/png';
    else if (['GIF87a', 'GIF89a'].includes(text(0, 6))) type = 'image/gif';
    else if (b.length >= 12 && text(0, 4) === 'RIFF' && text(8, 12) === 'WEBP') type = 'image/webp';
    else if (text(0, 2) === 'BM') type = 'image/bmp';
    else if (b.length >= 16 && text(4, 8) === 'ftyp') type = await ftypType(file, b);
    if (!type) throw Error('invalid-photo');
    const declared = (file.type || '').trim().toLowerCase().split(';')[0];
    const canonical = aliases[declared] || declared;
    const sameFamily = [type, canonical].every(v => v === 'image/heic' || v === 'image/heif');
    if (canonical && canonical !== 'application/octet-stream' && canonical !== type && !sameFamily) throw Error('invalid-photo');
    return type;
}
export async function validatePhoto(file, width, height) {
    const type = await sniffPhotoType(file);
    if (width !== undefined) validatePhotoDimensions(width, height);
    return type;
}
export function decodeFailure(type) {
    return type === 'image/heic' || type === 'image/heif' ? 'heic-unsupported' : type === 'image/avif' ? 'avif-unsupported' : 'photo-decode-failed';
}
