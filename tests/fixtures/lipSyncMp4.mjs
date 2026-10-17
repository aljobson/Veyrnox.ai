// Small structural containers for isolated duration admission tests, not decodable media.
const box = (type, payload) => {
  const bytes = Buffer.alloc(8 + payload.length);
  bytes.writeUInt32BE(bytes.length); bytes.write(type, 4); payload.copy(bytes, 8);
  return bytes;
};
const join = (...parts) => Buffer.concat(parts);
export function lipSyncMp4({ video = 7.2, movie = video, audio = null, duplicateVideo = false, handler = 'vide', enabled = true, edit = null, composition = false, compositionOffset = null, sampleCount = 180, duplicateHandler = false } = {}) {
  const scale = 10000;
  function track(seconds, kind) {
    const tkhd = Buffer.alloc(84); tkhd[3] = enabled ? 3 : 0;
    tkhd.writeUInt32BE(Math.round(seconds * scale), 20);
    if (kind !== 'soun') { tkhd.writeUInt32BE(640 * 65536, 76); tkhd.writeUInt32BE(360 * 65536, 80); }
    const mdhd = Buffer.alloc(24); mdhd.writeUInt32BE(scale, 12); mdhd.writeUInt32BE(Math.round(seconds * scale), 16);
    const hdlr = Buffer.alloc(24); hdlr.write(kind, 8);
    const stts = Buffer.alloc(16); stts.writeUInt32BE(1, 4); stts.writeUInt32BE(sampleCount, 8); stts.writeUInt32BE(Math.round(seconds * scale / sampleCount), 12);
    const stsz = Buffer.alloc(12); stsz.writeUInt32BE(1, 4); stsz.writeUInt32BE(sampleCount, 8);
    const compositionBytes = Buffer.alloc(16); compositionBytes.writeUInt32BE(1, 4); compositionBytes.writeUInt32BE(sampleCount, 8); compositionBytes.writeUInt32BE(Math.round((compositionOffset || 0) * scale), 12);
    const ctts = compositionOffset !== null ? box('ctts', compositionBytes) : composition ? box('ctts', Buffer.alloc(8)) : Buffer.alloc(0);
    const mdia = box('mdia', join(box('mdhd', mdhd), box('hdlr', hdlr), duplicateHandler ? box('hdlr', hdlr) : Buffer.alloc(0), box('minf', box('stbl', join(box('stts', stts), box('stsz', stsz), ctts)))));
    let edts = Buffer.alloc(0);
    if (edit && kind !== 'soun') {
      const elst = Buffer.alloc(20); elst.writeUInt32BE(1, 4); elst.writeUInt32BE(Math.round(edit.seconds * scale), 8);
      elst.writeInt32BE(Math.round((edit.start || 0) * scale), 12); elst.writeUInt16BE(edit.rate ?? 1, 16);
      edts = box('edts', box('elst', elst));
    }
    return box('trak', join(box('tkhd', tkhd), edts, mdia));
  }
  const mvhd = Buffer.alloc(100); mvhd.writeUInt32BE(scale, 12); mvhd.writeUInt32BE(Math.round(movie * scale), 16);
  const tracks = [track(video, handler)];
  if (duplicateVideo) tracks.push(track(video, 'vide'));
  if (audio !== null) tracks.push(track(audio, 'soun'));
  return join(box('ftyp', Buffer.from('isom0000')), box('moov', join(box('mvhd', mvhd), ...tracks)), box('mdat', Buffer.alloc(1024)));
}
