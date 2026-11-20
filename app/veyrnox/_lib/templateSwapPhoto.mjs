import { imageDimensions, sniffType } from '../../../lib/uploadSource.js';
import { inputTransform, mapBox, personAlpha, matteQuality, headShouldersBox, outputSize, resampleAlpha } from '../../../lib/templateSwapCutout.mjs';
import { faceBoxFromResult } from './templateSwapClient.mjs';
import { createVisionProcessor } from './editorVisionWorkerClient.mjs';
import { createFaceProcessor } from './liveEdit/faceClient.mjs';
export const checkAbort = signal => { if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError'); };
const requireOk = result => { if (!result.ok) throw Error(result.error); return result; };

// Only header-inspectable formats are offered. Refuse unknown dimensions BEFORE
// allocating a decoded image. JPEG metadata reads are bounded by the file cap.
export async function photoHeader(file) {
  if (!file || file.size <= 0 || file.size > 50 * 1024 * 1024) throw Error('photo_too_large');
  const bytes = new Uint8Array(await file.arrayBuffer());
  const size = imageDimensions(bytes);
  if (!size) throw Error('invalid_image');
  let orientation = 1;
  if (sniffType(bytes) === 'image/jpeg') {
    const view = new DataView(bytes.buffer);
    let at = 2;
    while (at + 4 < bytes.length && bytes[at] === 255) {
      const marker = bytes[at + 1], length = view.getUint16(at + 2);
      if (length < 2 || at + 2 + length > bytes.length) break;
      if (marker === 225 && String.fromCharCode(...bytes.slice(at + 4, at + 10)) === 'Exif\0\0') {
        const base = at + 10, end = at + 2 + length;
        if (base + 8 > end) throw Error('invalid_image');
        const little = view.getUint16(base) === 18761;
        const u16 = n => view.getUint16(n, little), u32 = n => view.getUint32(n, little);
        if (u16(base + 2) !== 42) throw Error('invalid_image');
        const dir = base + u32(base + 4);
        if (dir + 2 > end) throw Error('invalid_image');
        const count = u16(dir);
        if (dir + 2 + count * 12 > end) throw Error('invalid_image');
        for (let i = 0; i < count; i++) {
          const entry = dir + 2 + i * 12;
          if (u16(entry) === 274 && u16(entry + 2) === 3 && u32(entry + 4) === 1) orientation = u16(entry + 8);
        }
        break;
      }
      if (marker === 218 || marker === 217) break;
      at += length + 2;
    }
  }
  if (orientation < 1 || orientation > 8) throw Error('invalid_image');
  return { ...size, orientation, rotation: [5, 6].includes(orientation) ? 90 : [7, 8].includes(orientation) ? 270 : [3, 4].includes(orientation) ? 180 : 0 };
}
function bodyBounds(masks, size) {
  if (!masks.body) return null;
  let left = masks.width, top = masks.height, right = -1, bottom = -1;
  for (let y = 0; y < masks.height; y++) for (let x = 0; x < masks.width; x++) if (masks.body[y * masks.width + x] >= .5) {
    left = Math.min(left, x); right = Math.max(right, x); top = Math.min(top, y); bottom = Math.max(bottom, y);
  }
  return right < left ? null : { x: left * size.width / masks.width, y: top * size.height / masks.height,
    width: (right - left + 1) * size.width / masks.width, height: (bottom - top + 1) * size.height / masks.height };
}
function canvas(size) {
  const c = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(size.width, size.height) : document.createElement('canvas');
  c.width = size.width; c.height = size.height; return c;
}
async function png(c) {
  const blob = c.convertToBlob ? await c.convertToBlob({ type: 'image/png' }) : await new Promise(resolve => c.toBlob(resolve, 'image/png'));
  if (!blob || blob.type !== 'image/png' || blob.size > 20 * 1024 * 1024) throw Error('photo_too_large');
  return blob;
}
export async function encodeSwapPair(bitmap, alpha, crop, signal) {
  const size = requireOk(outputSize(bitmap)), c = canvas(size), ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(bitmap, 0, 0, size.width, size.height);
  const pixels = ctx.getImageData(0, 0, size.width, size.height), matte = resampleAlpha(alpha, size).data;
  // Flat neutral grey is an output-image contract, not a UI colour token.
  for (let i = 0; i < matte.length; i++) {
    const a = matte[i] * pixels.data[i * 4 + 3] / 255;
    for (let ch = 0; ch < 3; ch++) pixels.data[i * 4 + ch] = Math.round(pixels.data[i * 4 + ch] * a + 128 * (1 - a));
    pixels.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(pixels, 0, 0); checkAbort(signal);
  const cc = canvas(requireOk(outputSize(crop.output, 'crop'))), box = crop.box;
  cc.getContext('2d').drawImage(c, box.x, box.y, box.width, box.height, 0, 0, cc.width, cc.height);
  try { return [await png(c), await png(cc)]; }
  finally { c.width = c.height = cc.width = cc.height = 1; }
}
export async function processSwapPhoto(file, { signal, deps = {} } = {}) {
  checkAbort(signal);
  const header = await (deps.header || photoHeader)(file); checkAbort(signal);
  const transform = requireOk(inputTransform(header, header.rotation || 0));
  requireOk(outputSize(transform));
  let bitmap, vision, face;
  try {
    bitmap = await (deps.bitmap || createImageBitmap)(file, { imageOrientation: 'from-image', resizeWidth: transform.width, resizeHeight: transform.height, resizeQuality: 'high' });
    checkAbort(signal);
    if (bitmap.width !== transform.width || bitmap.height !== transform.height) throw Error('invalid_image');
    vision = await (deps.vision || createVisionProcessor)({ signal }); checkAbort(signal);
    face = await (deps.face || createFaceProcessor)({ signal }); checkAbort(signal);
    const detected = requireOk(faceBoxFromResult(await face.detect(bitmap), transform)); checkAbort(signal);
    const masks = await vision.segment(bitmap, 0); checkAbort(signal);
    const alpha = personAlpha(masks); requireOk(matteQuality(alpha));
    const originalFace = mapBox(detected.faceBox, transform);
    const crop = requireOk(headShouldersBox(mapBox(originalFace, transform, 'toInput'), bodyBounds(masks, transform), transform));
    const files = await (deps.encode || encodeSwapPair)(bitmap, alpha, crop, signal); checkAbort(signal);
    if (files.length !== 2 || files.some(f => f.type !== 'image/png' || f.size > 20 * 1024 * 1024)) throw Error('invalid_image');
    return { files, transform: { ...transform, orientation: header.orientation || 1 }, faceBox: originalFace };
  } finally { face?.close(); vision?.close(); bitmap?.close(); }
}
