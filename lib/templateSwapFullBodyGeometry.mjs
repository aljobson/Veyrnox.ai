// Full-body photo geometry (ADR-0351 amendment 18). Device-independent; boxes are in the pixel space of the image passed in.
// A standing person's face is small in frame, so the face is found again on a high-resolution crop of the head region and
// the identity image is a tight face crop taken from that high-resolution decode, not from the 1536 px working copy.
export const FULL_BODY_MIN_FACE_PX = 96; // shorter face-box side, in original (orientation-corrected) photo pixels
export const FULL_BODY_DECODE_MAX_SIDE = 4096;
export const FULL_BODY_DECODE_MAX_PIXELS = 12_000_000;
export const FACE_CROP_SCALE = 2.0; // square side = 2 x the longer face-box side (hair and chin kept)
export const FACE_CROP_MIN_OUTPUT = 512;
export const FACE_CROP_MAX_OUTPUT = 1024;
export const DETECT_MAX_SIDE = 1024;
const bad = error => ({ ok: false, error });
const validSize = s => s && Number.isInteger(s.width) && Number.isInteger(s.height) && s.width > 0 && s.height > 0;
const validBox = b => b && [b.x, b.y, b.width, b.height].every(Number.isFinite) && b.x >= 0 && b.y >= 0 && b.width > 0 && b.height > 0;
const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));

/** Size of the high-resolution decode of an oriented photo: never above the original, at most 4096 px a side and 12 MP. */
export function fullBodyDecodeSize(oriented) {
  if (!validSize(oriented)) return bad('invalid_image');
  const scale = Math.min(1, FULL_BODY_DECODE_MAX_SIDE / Math.max(oriented.width, oriented.height),
    Math.sqrt(FULL_BODY_DECODE_MAX_PIXELS / (oriented.width * oriented.height)));
  return { ok: true, width: Math.max(1, Math.round(oriented.width * scale)), height: Math.max(1, Math.round(oriented.height * scale)), scale };
}

/** A whole-pixel square of `side` centred on (cx, cy), shrunk to fit and moved inside the image. */
function square(cx, cy, side, size) {
  const s = Math.max(1, Math.floor(Math.min(side, size.width, size.height)));
  return { x: Math.round(clamp(cx - s / 2, 0, size.width - s)), y: Math.round(clamp(cy - s / 2, 0, size.height - s)), width: s, height: s };
}

/** Region to look for the face in at high resolution: around a face found on the working copy, else the top of the person. */
export function faceSearchBox(face, body, size) {
  if (!validSize(size)) return null;
  if (validBox(face)) return square(face.x + face.width / 2, face.y + face.height / 2, 4 * Math.max(face.width, face.height), size);
  if (!validBox(body)) return null;
  const side = Math.min(body.width, body.height * 0.4);
  return square(body.x + body.width / 2, body.y + side / 2 - side * 0.1, side, size);
}

/** Scale that brings a region to at most DETECT_MAX_SIDE for the face detector (never upscales). */
export const detectSize = region => {
  const scale = Math.min(1, DETECT_MAX_SIDE / Math.max(region.width, region.height));
  return { width: Math.max(1, Math.round(region.width * scale)), height: Math.max(1, Math.round(region.height * scale)) };
};

/** Face box from a 478-point landmark result normalised to `region` (a sub-rectangle of the image). */
export function landmarkBox(result, region) {
  const points = result?.landmarks;
  if (result?.count !== 1 || !(points instanceof Float32Array) || points.length !== 478 * 3 || !points.every(Number.isFinite)) return null;
  let left = 1, top = 1, right = 0, bottom = 0;
  for (let i = 0; i < points.length; i += 3) {
    const x = clamp(points[i], 0, 1), y = clamp(points[i + 1], 0, 1);
    left = Math.min(left, x); right = Math.max(right, x); top = Math.min(top, y); bottom = Math.max(bottom, y);
  }
  const box = { x: region.x + left * region.width, y: region.y + top * region.height, width: (right - left) * region.width, height: (bottom - top) * region.height };
  return validBox(box) ? box : null;
}

/** One clear rule: the face must be at least 96 px on its shorter side in the original photo (one message: face_too_small_full). */
export function checkFullBodyFace(face, size, pixelScale = 1) {
  if (!validSize(size) || !validBox(face) || face.x + face.width > size.width + 1e-6 || face.y + face.height > size.height + 1e-6) return bad('invalid_face');
  if (Math.min(face.width, face.height) / pixelScale < FULL_BODY_MIN_FACE_PX) return bad('face_too_small_full');
  return { ok: true, faceBox: { ...face } };
}

/** Tight square face crop (hair and chin included) and its output size, 512 to 1024 px (upscaled when the face is small). */
export function faceCropBox(face, size) {
  if (!validSize(size) || !validBox(face)) return bad('invalid_face');
  const box = square(face.x + face.width / 2, face.y + face.height * 0.4, FACE_CROP_SCALE * Math.max(face.width, face.height), size);
  if (box.x > face.x + 1e-6 || box.y > face.y + 1e-6 || box.x + box.width < face.x + face.width - 1e-6) return bad('template_swap_image_size');
  const side = clamp(box.width, FACE_CROP_MIN_OUTPUT, FACE_CROP_MAX_OUTPUT);
  return { ok: true, box, output: { width: side, height: side } };
}

/** Bounding box (in `size` pixels) of a model-grid channel above 0.5; `invert` reads a background channel as the person. */
export function maskBounds(values, grid, size, invert = false) {
  if (!values || !validSize(grid) || values.length !== grid.width * grid.height || !validSize(size)) return null;
  let left = grid.width, top = grid.height, right = -1, bottom = -1;
  for (let y = 0; y < grid.height; y++) for (let x = 0; x < grid.width; x++) {
    const v = values[y * grid.width + x];
    if (invert ? v < 0.5 : v >= 0.5) { left = Math.min(left, x); right = Math.max(right, x); top = Math.min(top, y); bottom = Math.max(bottom, y); }
  }
  return right < left ? null : { x: left * size.width / grid.width, y: top * size.height / grid.height,
    width: (right - left + 1) * size.width / grid.width, height: (bottom - top + 1) * size.height / grid.height };
}

/** Where to look for the face: the landmark face, else the segmenter's face-skin class, else the top of the person. */
export function headHint(rough, masks, size) {
  if (validBox(rough)) return { face: rough, person: maskBounds(masks?.background, masks, size, true) };
  const person = masks?.background ? maskBounds(masks.background, masks, size, true) : maskBounds(masks?.body, masks, size);
  return { face: maskBounds(masks?.face, masks, size), person };
}
