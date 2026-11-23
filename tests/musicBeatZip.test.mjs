import test from 'node:test';
import assert from 'node:assert/strict';
import { deflateRawSync } from 'node:zlib';
import { extractStem, extractStemFromReader, inspectStem, uint8ZipReader, ZIP_READ_CHUNK } from '../app/veyrnox/_lib/music/beat/beatZip.mjs';
function crc(bytes) { let c=0xffffffff;for(const b of bytes){c^=b;for(let i=0;i<8;i++)c=(c>>>1)^(c&1?0xedb88320:0);}return ~c>>>0; }
function zip({ method=0, names=['vocals.wav','instrumental.wav'], flags=0, size, count, offset, payload }={}) {
  const locals=[],centrals=[];let at=0;
  for(const name of names) {
    const text=Buffer.from(name), raw=payload??Buffer.from(`audio:${name}`), data=method===8?deflateRawSync(raw):raw;
    const header=Buffer.alloc(30);header.writeUInt32LE(0x04034b50);header.writeUInt16LE(flags,6);header.writeUInt16LE(method,8);header.writeUInt32LE(crc(raw),14);
    header.writeUInt32LE(data.length,18);header.writeUInt32LE(size??raw.length,22);header.writeUInt16LE(text.length,26);
    locals.push(header,text,data);
    const central=Buffer.alloc(46);central.writeUInt32LE(0x02014b50);central.writeUInt16LE(flags,8);central.writeUInt16LE(method,10);central.writeUInt32LE(crc(raw),16);
    central.writeUInt32LE(data.length,20);central.writeUInt32LE(size??raw.length,24);central.writeUInt16LE(text.length,28);central.writeUInt32LE(offset??at,42);
    centrals.push(central,text);at+=header.length+text.length+data.length;
  }
  const central=Buffer.concat(centrals),end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50);end.writeUInt16LE(count??names.length,8);end.writeUInt16LE(count??names.length,10);
  end.writeUInt32LE(central.length,12);end.writeUInt32LE(at,16);
  return new Uint8Array(Buffer.concat([...locals,central,end]));
}
for(const method of [0,8]) test(`ZIP method ${method} selects one unambiguous vocal and the other audio entry`,async()=>{
  for(const part of ['vocals','instrumental'])assert.equal(new TextDecoder().decode(await extractStem(zip({method}),part)),`audio:${part}.wav`);
});
test('ZIP refuses encrypted, zip64, unsupported, ambiguous, oversized and malformed archives',async()=>{
  for(const options of [{flags:1},{method:12},{size:0xffffffff},{offset:0xffffffff},{size:120000001},{count:17},
    {names:['vocals.wav','vocal2.wav']},{names:['guitar.wav','bass.wav']},{names:['vocals.wav']},{names:['vocals.wav','bass.wav','drums.wav']},{size:1,method:8}])
    await assert.rejects(extractStem(zip(options),'vocals'),/unexpected layout/);
  const corrupt=zip();corrupt[45]^=255;await assert.rejects(extractStem(corrupt,'vocals'));
  await assert.rejects(extractStem(new Uint8Array(30),'vocals'),/unexpected layout/);
});

test('CRC verifies a multi-chunk payload and yields between chunks; corrupted CRC is refused', async () => {
  const payload = Buffer.alloc(3 * 1024 * 1024 + 17);
  for (let i = 0; i < payload.length; i++) payload[i] = i % 251;
  const bytes = zip({ payload });
  let yields = 0;
  const timer = setInterval(() => yields++, 0);
  try { assert.deepEqual(await extractStem(bytes, 'vocals'), new Uint8Array(payload)); }
  finally { clearInterval(timer); }
  assert.ok(yields >= 3, 'each completed non-final chunk gives timers a turn');
  bytes[30 + Buffer.byteLength('vocals.wav') + 2 * 1024 * 1024] ^= 1;
  await assert.rejects(extractStem(bytes, 'vocals'), /unexpected layout/);
});

test('random-access inspection and extraction never request the whole archive or an oversized range', async () => {
  const payload = Buffer.alloc(3 * 1024 * 1024 + 17, 7), bytes = zip({ payload });
  const calls = [];
  const reader = {
    size: bytes.length,
    async read(offset, length) { calls.push([offset, length]); return bytes.slice(offset, offset + length); },
  };
  const selected = await inspectStem(reader, 'vocals');
  assert.equal(selected.size, payload.length);
  assert.deepEqual(await extractStemFromReader(reader, 'vocals'), new Uint8Array(payload));
  assert.ok(calls.every(([, length]) => length <= ZIP_READ_CHUNK));
  assert.ok(calls.every(([, length]) => length < bytes.length));
  assert.ok(calls.some(([, length]) => length === 46), 'central records are read incrementally');
});

test('the Uint8Array adapter copies bounded ranges and rejects invalid coordinates', async () => {
  const bytes = zip(), reader = uint8ZipReader(bytes);
  const copy = await reader.read(0, 4);
  copy[0] = 0;
  assert.equal(bytes[0], 0x50);
  await assert.rejects(reader.read(-1, 1), /unexpected layout/);
  await assert.rejects(reader.read(bytes.length, 1), /unexpected layout/);
});

test('short ranged reads and malformed local/central metadata fail permanently', async () => {
  const bytes = zip(), short = uint8ZipReader(bytes);
  await assert.rejects(inspectStem({ size: short.size, read: async (offset, length) => {
    const value = await short.read(offset, length); return value.length ? value.subarray(0, value.length - 1) : value;
  } }, 'vocals'), error => error.permanent === true);

  const localName = zip(); localName[30] ^= 1;
  await assert.rejects(extractStem(localName, 'vocals'), /unexpected layout/);
  const localMethod = zip(); localMethod[8] = 8;
  await assert.rejects(extractStem(localMethod, 'vocals'), /unexpected layout/);
  const centralSignature = zip();
  const end = centralSignature.length - 22, central = new DataView(centralSignature.buffer).getUint32(end + 16, true);
  centralSignature[central] = 0;
  await assert.rejects(extractStem(centralSignature, 'vocals'), /unexpected layout/);
});

test('streaming inflater receives bounded chunks, exactly one final input, and is output-bounded', async () => {
  const payload = Buffer.alloc(3 * 1024 * 1024 + 17, 4), bytes = zip({ method: 8, payload });
  const raw = deflateRawSync(payload), chunks = [];
  const inflate = async (source, emit) => {
    const input = [];
    for (;;) {
      const item = await source.next();
      if (!item) break;
      chunks.push(item); input.push(item.bytes);
    }
    emit(new Uint8Array(Buffer.from(raw).equals(Buffer.concat(input.map(item => Buffer.from(item)))) ? payload : new Uint8Array()));
  };
  assert.deepEqual(await extractStemFromReader(uint8ZipReader(bytes), 'vocals', inflate), new Uint8Array(payload));
  assert.equal(chunks.filter(item => item.final).length, 1);
  assert.ok(chunks.every(item => item.bytes.length <= ZIP_READ_CHUNK));

  await assert.rejects(extractStemFromReader(uint8ZipReader(bytes), 'vocals', async (source, emit) => {
    while (await source.next()) { /* drain */ }
    emit(new Uint8Array(payload.length + 1));
  }), /unexpected layout/);
  await assert.rejects(extractStemFromReader(uint8ZipReader(bytes), 'vocals', async (source, emit) => {
    while (await source.next()) { /* drain */ }
    emit(new Uint8Array(payload.length - 1));
  }), /unexpected layout/);
});
