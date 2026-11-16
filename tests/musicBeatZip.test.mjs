import test from 'node:test';
import assert from 'node:assert/strict';
import { deflateRawSync } from 'node:zlib';
import { extractStem } from '../app/veyrnox/_lib/music/beat/beatZip.mjs';
function crc(bytes) { let c=0xffffffff;for(const b of bytes){c^=b;for(let i=0;i<8;i++)c=(c>>>1)^(c&1?0xedb88320:0);}return ~c>>>0; }
function zip({ method=0, names=['vocals.wav','instrumental.wav'], flags=0, size, count, offset }={}) {
  const locals=[],centrals=[];let at=0;
  for(const name of names) {
    const text=Buffer.from(name), raw=Buffer.from(`audio:${name}`), data=method===8?deflateRawSync(raw):raw;
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
