// Random-access central-directory reader. Archive paths are never written to disk and every
// compressed/expanded byte count is bounded before allocation.
export const ZIP_LIMIT = 120000000;
export const ZIP_READ_CHUNK = 1024 * 1024;
const EOCD_TAIL = 22 + 0xffff;
const EMPTY = new Uint8Array();
const CRC_TABLE = Uint32Array.from({ length: 256 }, (_, byte) => {
  let crc = byte;
  for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  return crc >>> 0;
});
const bad = () => Object.assign(new Error('This stem archive has an unexpected layout'), { permanent: true });
const unsupported = () => Object.assign(new Error('This browser cannot open compressed stem archives'), { permanent: true });
const view = bytes => new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
const u16 = (bytes, at) => view(bytes).getUint16(at, true);
const u32 = (bytes, at) => view(bytes).getUint32(at, true);
const range = (size, offset, length) => Number.isSafeInteger(offset) && offset >= 0
  && Number.isSafeInteger(length) && length >= 0 && offset <= size && length <= size - offset;

async function readExact(reader, offset, length) {
  if (!range(reader.size, offset, length)) throw bad();
  const bytes = await reader.read(offset, length);
  if (!(bytes instanceof Uint8Array) || bytes.length !== length) throw bad();
  return bytes;
}

export function uint8ZipReader(bytes) {
  if (!(bytes instanceof Uint8Array)) throw bad();
  return {
    size: bytes.length,
    async read(offset, length) {
      if (!range(bytes.length, offset, length)) throw bad();
      return bytes.slice(offset, offset + length);
    },
  };
}

function decodeName(bytes) {
  try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
  catch { throw bad(); }
}

/** Inspect the two expected stem entries once without reading their payloads. */
export async function inspectStems(reader) {
  if (!reader || !Number.isSafeInteger(reader.size) || reader.size < 22 || reader.size > ZIP_LIMIT
    || typeof reader.read !== 'function') throw bad();
  const tailStart = Math.max(0, reader.size - EOCD_TAIL);
  const tail = await readExact(reader, tailStart, reader.size - tailStart);
  let endInTail = -1;
  for (let at = tail.length - 22; at >= 0; at--) {
    if (u32(tail, at) === 0x06054b50 && at + 22 + u16(tail, at + 20) === tail.length) {
      endInTail = at; break;
    }
  }
  if (endInTail < 0 || u16(tail, endInTail + 4) || u16(tail, endInTail + 6)
    || u16(tail, endInTail + 8) !== u16(tail, endInTail + 10)) throw bad();
  const count = u16(tail, endInTail + 10);
  const centralSize = u32(tail, endInTail + 12);
  const central = u32(tail, endInTail + 16);
  const end = tailStart + endInTail;
  if (!count || count > 16 || central > end || centralSize !== end - central) throw bad();

  const entries = [];
  let at = central, expanded = 0;
  for (let i = 0; i < count; i++) {
    if (at > end - 46) throw bad();
    const fixed = await readExact(reader, at, 46);
    if (u32(fixed, 0) !== 0x02014b50) throw bad();
    const flags = u16(fixed, 8), method = u16(fixed, 10), crc = u32(fixed, 16);
    const compressed = u32(fixed, 20), size = u32(fixed, 24);
    const nameLen = u16(fixed, 28), extraLen = u16(fixed, 30), commentLen = u16(fixed, 32);
    const disk = u16(fixed, 34), offset = u32(fixed, 42);
    const variableLength = nameLen + extraLen + commentLen;
    if ((flags & 0x41) || ![0, 8].includes(method) || disk || [compressed, size, offset].includes(0xffffffff)
      || compressed > ZIP_LIMIT || size > ZIP_LIMIT || variableLength > end - at - 46) throw bad();
    const nameAndExtra = await readExact(reader, at + 46, nameLen + extraLen);
    for (let x = nameLen; x < nameAndExtra.length;) {
      if (x > nameAndExtra.length - 4 || u16(nameAndExtra, x) === 1) throw bad();
      const length = u16(nameAndExtra, x + 2);
      x += 4;
      if (length > nameAndExtra.length - x) throw bad();
      x += length;
    }
    expanded += size;
    if (expanded > ZIP_LIMIT) throw bad();
    const name = decodeName(nameAndExtra.subarray(0, nameLen));

    if (offset > central - 30) throw bad();
    const local = await readExact(reader, offset, 30);
    if (u32(local, 0) !== 0x04034b50 || u16(local, 6) !== flags || u16(local, 8) !== method) throw bad();
    const localNameLen = u16(local, 26), localExtraLen = u16(local, 28);
    const start = offset + 30 + localNameLen + localExtraLen;
    if (!Number.isSafeInteger(start) || start > central || compressed > central - start) throw bad();
    const localName = decodeName(await readExact(reader, offset + 30, localNameLen));
    if (localName !== name) throw bad();
    if (/\.(wav|mp3|flac)$/i.test(name)) entries.push({
      name: name.split('/').at(-1), start, compressed, size, method, crc,
    });
    at += 46 + variableLength;
  }
  if (at !== end || entries.length !== 2) throw bad();
  const vocals = entries.filter(entry => /^vocal/i.test(entry.name));
  if (vocals.length !== 1) throw bad();
  return { vocals: vocals[0], instrumental: entries.find(entry => entry !== vocals[0]) };
}

/** Inspect and select one of the two expected stem entries without reading its payload. */
export async function inspectStem(reader, part) {
  if (!['vocals', 'instrumental'].includes(part)) throw bad();
  return (await inspectStems(reader))[part];
}

function compressedSource(reader, entry) {
  let offset = 0, emptySent = false;
  return { async next() {
    if (offset === entry.compressed) {
      if (!entry.compressed && !emptySent) { emptySent = true; return { bytes: EMPTY, final: true }; }
      return null;
    }
    const length = Math.min(ZIP_READ_CHUNK, entry.compressed - offset);
    const bytes = await readExact(reader, entry.start + offset, length);
    offset += length;
    return { bytes, final: offset === entry.compressed };
  } };
}

async function browserInflate(source, emit) {
  let stream;
  try {
    stream = new ReadableStream({
      async pull(controller) {
        try {
          const item = await source.next();
          if (!item) { controller.close(); return; }
          controller.enqueue(item.bytes);
          if (item.final) controller.close();
        } catch (error) { controller.error(error); }
      },
    }).pipeThrough(new DecompressionStream('deflate-raw'));
  } catch { throw unsupported(); }
  const output = stream.getReader();
  try {
    while (true) {
      let result;
      try { result = await output.read(); }
      catch { throw bad(); }
      if (result.done) break;
      emit(result.value);
    }
  } finally { await output.cancel().catch(() => undefined); }
}

/** Extract from a bounded random-access source. Native supplies a streaming raw-DEFLATE adapter. */
export async function extractStemEntryFromReader(reader, entry, inflateRaw = browserInflate) {
  const output = new Uint8Array(entry.size);
  let length = 0, crc = 0xffffffff, sinceYield = 0;
  const emit = chunk => {
    if (!(chunk instanceof Uint8Array) || chunk.length > output.length - length) throw bad();
    output.set(chunk, length); length += chunk.length;
    for (const byte of chunk) crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ byte) & 255];
    sinceYield += chunk.length;
  };
  const source = compressedSource(reader, entry);
  if (entry.method === 8) {
    if (typeof inflateRaw !== 'function') throw bad();
    await inflateRaw(source, emit);
  } else {
    while (true) {
      const item = await source.next();
      if (!item) break;
      emit(item.bytes);
      if (sinceYield >= ZIP_READ_CHUNK && !item.final) {
        sinceYield = 0;
        await new Promise(resolve => setTimeout(resolve, 0));
      }
    }
  }
  if (length !== entry.size || (~crc >>> 0) !== entry.crc) throw bad();
  return output;
}

export async function extractStemFromReader(reader, part, inflateRaw = browserInflate) {
  return extractStemEntryFromReader(reader, await inspectStem(reader, part), inflateRaw);
}

/** Inspect once and extract both parts sequentially so native never redownloads or rescans one request. */
export async function extractStemsFromReader(reader, inflateRaw = browserInflate) {
  const entries = await inspectStems(reader);
  return {
    vocals: await extractStemEntryFromReader(reader, entries.vocals, inflateRaw),
    instrumental: await extractStemEntryFromReader(reader, entries.instrumental, inflateRaw),
  };
}

/** Backwards-compatible in-memory web adapter. */
export async function extractStem(bytes, part) {
  try { return await extractStemFromReader(uint8ZipReader(bytes), part); }
  catch (error) { throw error?.permanent ? error : bad(); }
}
