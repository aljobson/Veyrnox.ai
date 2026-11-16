// Central-directory reader; no paths are written to disk and decompression is bounded.
export const ZIP_LIMIT = 120000000;
const bad = () => Object.assign(new Error('This stem archive has an unexpected layout'), { permanent: true });
export async function extractStem(bytes, part) {
  try { return await extract(bytes, part); }
  catch (error) { throw error.permanent ? error : bad(); }
}
async function extract(bytes, part) {
  if (!(bytes instanceof Uint8Array) || bytes.length > ZIP_LIMIT || bytes.length < 22 || !['vocals', 'instrumental'].includes(part)) throw bad();
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const u16 = at => v.getUint16(at, true), u32 = at => v.getUint32(at, true);
  let end = -1;
  for (let at = bytes.length - 22; at >= Math.max(0, bytes.length - 65557); at--) {
    if (u32(at) === 0x06054b50 && at + 22 + u16(at + 20) === bytes.length) { end = at; break; }
  }
  if (end < 0 || u16(end + 4) || u16(end + 6) || u16(end + 8) !== u16(end + 10)) throw bad();
  const count = u16(end + 10), centralSize = u32(end + 12), central = u32(end + 16);
  if (!count || count > 16 || central + centralSize !== end) throw bad();
  const entries = []; let at = central, expanded = 0;
  for (let i = 0; i < count; i++) {
    if (at + 46 > end || u32(at) !== 0x02014b50) throw bad();
    const flags = u16(at + 8), method = u16(at + 10), compressed = u32(at + 20), size = u32(at + 24);
    const nameLen = u16(at + 28), extraLen = u16(at + 30), commentLen = u16(at + 32), offset = u32(at + 42);
    if ((flags & 0x41) || ![0, 8].includes(method) || u16(at + 34) || [compressed, size, offset].includes(0xffffffff)
      || compressed > ZIP_LIMIT || size > ZIP_LIMIT || at + 46 + nameLen + extraLen + commentLen > end) throw bad();
    for (let x = at + 46 + nameLen; x < at + 46 + nameLen + extraLen;) {
      if (x + 4 > at + 46 + nameLen + extraLen || u16(x) === 1) throw bad();
      x += 4 + u16(x + 2); if (x > at + 46 + nameLen + extraLen) throw bad();
    }
    expanded += size; if (expanded > ZIP_LIMIT) throw bad();
    const name = new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(at + 46, at + 46 + nameLen));
    if (offset + 30 > central || u32(offset) !== 0x04034b50 || u16(offset + 6) !== flags || u16(offset + 8) !== method) throw bad();
    const start = offset + 30 + u16(offset + 26) + u16(offset + 28);
    if (start + compressed > central) throw bad();
    const localName = new TextDecoder().decode(bytes.subarray(offset + 30, offset + 30 + u16(offset + 26)));
    if (localName !== name) throw bad();
    if (/\.(wav|mp3|flac)$/i.test(name)) entries.push({ name: name.split('/').at(-1), start, compressed, size, method, crc: u32(at + 16) });
    at += 46 + nameLen + extraLen + commentLen;
  }
  if (at !== end || entries.length !== 2) throw bad();
  const vocals = entries.filter(e => /^vocal/i.test(e.name));
  if (vocals.length !== 1) throw bad();
  const entry = part === 'vocals' ? vocals[0] : entries.find(e => e !== vocals[0]);
  const compressed = bytes.subarray(entry.start, entry.start + entry.compressed);
  let output;
  if (entry.method === 0) output = compressed.slice();
  else {
    let stream;
    try { stream = new Blob([compressed]).stream().pipeThrough(new DecompressionStream('deflate-raw')); }
    catch { throw Object.assign(new Error('This browser cannot open compressed stem archives'), { permanent: true }); }
    const reader = stream.getReader(); output = new Uint8Array(entry.size); let length = 0;
    try {
      while (true) { const { value, done } = await reader.read(); if (done) break;
        if (length + value.length > entry.size) throw bad(); output.set(value, length); length += value.length; }
      if (length !== entry.size) throw bad();
    } finally { await reader.cancel(); }
  }
  if (output.length !== entry.size) throw bad();
  let crc = 0xffffffff;
  for (const b of output) { crc ^= b; for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0); }
  if ((~crc >>> 0) !== entry.crc) throw bad();
  return output;
}
