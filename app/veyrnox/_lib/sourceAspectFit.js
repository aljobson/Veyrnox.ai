import { GatewayError } from './gateway.js';
import { generationSlotKind, sourceList } from '../../../lib/generationSourceSlots.mjs';

// The most of a picture an automatic crop may remove. A 10% strip fixes near misses such as a 0.39 phone screenshot on a
// 0.4 limit while keeping the subject; anything further is a composition choice, so the person is asked to crop it.
export const MAX_ASPECT_CROP_FRACTION = 0.1;
const ASPECT_ERROR = 'source_aspect_out_of_range';
const DEFAULT_TYPES = Object.freeze(['image/jpeg', 'image/png', 'image/webp']);
const UPLOAD_MAX_BYTES = 20 * 1024 * 1024; // lib/uploadSource.js
const JPEG_QUALITIES = Object.freeze([0.95, 0.85]);

export const hasAspectBounds = spec => Number.isFinite(spec?.minAspect) && Number.isFinite(spec?.maxAspect);

/** A published bound as a plain shape: 0.4 is "2:5", 2.5 is "5:2". */
export function aspectShapeLabel(aspect) {
  for (let height = 1; height <= 20; height += 1) {
    const width = Math.round(aspect * height);
    if (width > 0 && Math.abs(width / height - aspect) < 1e-6) return `${width}:${height}`;
  }
  return aspect.toFixed(2);
}

/**
 * What to do with a picture of this size. Never enlarges. A too-tall picture keeps its top, where a face usually is;
 * a too-wide one is cropped evenly from both sides.
 * @returns {{action:'keep'}|{action:'crop',rect:{x:number,y:number,width:number,height:number}}|{action:'refuse',code:string}}
 */
export function aspectFitPlan({ width, height }, spec) {
  if (!hasAspectBounds(spec) || !(width > 0) || !(height > 0)) return { action: 'keep' };
  const aspect = width / height;
  if (aspect >= spec.minAspect && aspect <= spec.maxAspect) return { action: 'keep' };
  const rect = aspect < spec.minAspect
    ? { x: 0, y: 0, width, height: Math.floor(width / spec.minAspect) }
    : { x: 0, y: 0, width: Math.floor(height * spec.maxAspect), height };
  rect.x = Math.floor((width - rect.width) / 2);
  const removed = 1 - (rect.width * rect.height) / (width * height);
  if (removed > MAX_ASPECT_CROP_FRACTION) return { action: 'refuse', code: ASPECT_ERROR };
  if (spec.minSide && Math.min(rect.width, rect.height) < spec.minSide) return { action: 'refuse', code: 'source_resolution_out_of_range' };
  return { action: 'crop', rect };
}

async function openBitmap(file, createBitmap) {
  // from-image applies EXIF orientation, so the size measured is the size the person sees.
  try { return await createBitmap(file, { imageOrientation: 'from-image' }); }
  catch (error) { if (error?.name === 'TypeError') return createBitmap(file); throw error; }
}

const browserDeps = () => ({
  createBitmap: (...args) => createImageBitmap(...args),
  createCanvas: () => document.createElement('canvas'),
});

/** The file's displayed size, or null when the browser cannot read it (the server stays the judge). */
export async function measureImage(file, deps = browserDeps()) {
  let bitmap;
  try {
    bitmap = await openBitmap(file, deps.createBitmap);
    return { width: bitmap.width, height: bitmap.height };
  } catch { return null; } finally { bitmap?.close?.(); }
}

const encode = (canvas, type, quality) => new Promise(resolve => canvas.toBlob(resolve, type, quality));

async function encodeWithin(canvas, file, spec) {
  const allowed = spec.contentTypes || DEFAULT_TYPES;
  const limit = Math.min(spec.maxBytesExclusive ?? Infinity, UPLOAD_MAX_BYTES + 1);
  const wanted = allowed.includes(file.type) ? file.type : 'image/jpeg';
  const first = await encode(canvas, wanted, JPEG_QUALITIES[0]);
  if (first && allowed.includes(first.type) && first.size < limit) return first;
  if (!allowed.includes('image/jpeg')) return null;
  for (const quality of JPEG_QUALITIES) {
    const blob = await encode(canvas, 'image/jpeg', quality);
    if (blob?.type === 'image/jpeg' && blob.size < limit) return blob;
  }
  return null;
}

const refusal = code => new GatewayError(code, { status: 400, code });

/** The file to upload for this slot: itself, or a small crop that meets the slot's published shape. */
export async function fitImageFile(file, spec, deps = browserDeps()) {
  if (!hasAspectBounds(spec) || !String(file?.type || '').startsWith('image/')) return file;
  let bitmap;
  try { bitmap = await openBitmap(file, deps.createBitmap); } catch { return file; }
  try {
    const plan = aspectFitPlan(bitmap, spec);
    if (plan.action === 'keep') return file;
    if (plan.action === 'refuse') throw refusal(plan.code);
    const { rect } = plan;
    const canvas = deps.createCanvas();
    canvas.width = rect.width;
    canvas.height = rect.height;
    canvas.getContext('2d').drawImage(bitmap, rect.x, rect.y, rect.width, rect.height, 0, 0, rect.width, rect.height);
    const blob = await encodeWithin(canvas, file, spec);
    if (!blob) throw refusal('source_too_large');
    return new File([blob], file.name || 'image', { type: blob.type, lastModified: file.lastModified });
  } finally { bitmap.close?.(); }
}

/** Every local picture fitted before the first upload, so a refused picture means nothing was sent. */
export async function fitSourcesForUpload(media, sources, fit = fitImageFile) {
  const fitted = new Map();
  for (const [slot, value] of Object.entries(sources || {})) {
    const spec = media?.[slot];
    if (!spec || generationSlotKind(slot) !== 'image') continue;
    for (const source of sourceList(value)) {
      if (source?.file && !source.assetId && !source.sourceKey) fitted.set(source, await fit(source.file, spec));
    }
  }
  return fitted;
}
