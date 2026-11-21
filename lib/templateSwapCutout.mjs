// Device-independent matte/geometry only. Platform adapters own decoding,
// orientation correction, detector calls, grey compositing and PNG encoding.
export const MATTE_SMOOTHSTEP_LOW = 0.4;
export const MATTE_SMOOTHSTEP_HIGH = 0.6;
export const MATTE_GRID_SIZE = 256;
export const MATTE_MAX_RAGGEDNESS = 1.55;
export const MATTE_MAX_STRAY_COMPONENT = 0.01;
export const MATTE_MAX_STRAY_TOTAL = 0.02;
export const MATTE_MIN_COVERAGE = 0.04;
export const MATTE_MAX_COVERAGE = 0.90;
export const MATTE_FEATHER_PX = 2;
export const FACE_MIN_SIDE = 0.05;
const bad = error => ({ ok: false, error });
const clamp = (n, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, n));
const validSize = s => s && Number.isInteger(s.width) && Number.isInteger(s.height) && s.width > 0 && s.height > 0;
function validGrid(grid) {
  return validSize(grid) && grid.data?.length === grid.width * grid.height
    && grid.data.every(v => Number.isFinite(v) && v >= 0 && v <= 1);
}

/** Channels are model-grid arrays. Prefer background; otherwise sum available
 * body, face, hair and clothes probabilities. Sharpen BEFORE any upsampling. */
export function personAlpha(masks) {
  if (!validSize(masks)) throw new Error('invalid_mask');
  const length = masks.width * masks.height;
  const channels = masks.background ? [masks.background] : ['body', 'face', 'hair', 'clothes'].map(k => masks[k]).filter(Boolean);
  if (!channels.length || channels.some(c => c.length !== length || !c.every(Number.isFinite))) throw new Error('invalid_mask');
  const data = Float32Array.from({ length }, (_, i) => {
    const confidence = masks.background ? 1 - masks.background[i] : channels.reduce((sum, c) => sum + c[i], 0);
    const t = clamp((confidence - MATTE_SMOOTHSTEP_LOW) / (MATTE_SMOOTHSTEP_HIGH - MATTE_SMOOTHSTEP_LOW));
    return t * t * (3 - 2 * t);
  });
  return { width: masks.width, height: masks.height, data };
}

/** Bilinear pixel-centre sampling, followed by a separable 2px box feather in
 * OUTPUT pixels. Quality checks use the sharpened model grid, not this matte. */
export function resampleAlpha(alpha, size, feather = MATTE_FEATHER_PX) {
  if (!validGrid(alpha) || !validSize(size) || !Number.isInteger(feather) || feather < 0 || feather > 2) throw new Error('invalid_mask');
  const { width, height } = size, data = new Float32Array(width * height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const sx = clamp((x + .5) * alpha.width / width - .5, 0, alpha.width - 1);
    const sy = clamp((y + .5) * alpha.height / height - .5, 0, alpha.height - 1);
    const x0 = Math.floor(sx), y0 = Math.floor(sy), x1 = Math.min(x0 + 1, alpha.width - 1), y1 = Math.min(y0 + 1, alpha.height - 1);
    const a = alpha.data[y0 * alpha.width + x0] * (1 - sx + x0) + alpha.data[y0 * alpha.width + x1] * (sx - x0);
    const b = alpha.data[y1 * alpha.width + x0] * (1 - sx + x0) + alpha.data[y1 * alpha.width + x1] * (sx - x0);
    data[y * width + x] = a * (1 - sy + y0) + b * (sy - y0);
  }
  if (!feather) return { width, height, data };
  const temp = new Float32Array(data.length), count = 2 * feather + 1;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    let sum = 0;
    for (let d = -feather; d <= feather; d++) sum += data[y * width + clamp(x + d, 0, width - 1)];
    temp[y * width + x] = sum / count;
  }
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    let sum = 0;
    for (let d = -feather; d <= feather; d++) sum += temp[clamp(y + d, 0, height - 1) * width + x];
    data[y * width + x] = sum / count;
  }
  return { width, height, data };
}

// Canonical grid is always 256 on the long side (including smaller inputs).
function binaryGrid(alpha) {
  const scale = MATTE_GRID_SIZE / Math.max(alpha.width, alpha.height);
  const width = Math.max(1, Math.round(alpha.width * scale)), height = Math.max(1, Math.round(alpha.height * scale));
  const data = Uint8Array.from({ length: width * height }, (_, i) => {
    const x = Math.min(alpha.width - 1, Math.floor((i % width + .5) * alpha.width / width));
    const y = Math.min(alpha.height - 1, Math.floor((Math.floor(i / width) + .5) * alpha.height / height));
    return +(alpha.data[y * alpha.width + x] >= .5);
  });
  return { width, height, data };
}
function components({ width, height, data }) {
  const seen = new Uint8Array(data.length), blobs = [];
  for (let i = 0; i < data.length; i++) {
    if (!data[i] || seen[i]) continue;
    const blob = [i]; seen[i] = 1;
    for (let at = 0; at < blob.length; at++) {
      const x = blob[at] % width, y = Math.floor(blob[at] / width);
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx, ny = y + dy, n = ny * width + nx;
        if (nx >= 0 && nx < width && ny >= 0 && ny < height && data[n] && !seen[n]) { seen[n] = 1; blob.push(n); }
      }
    }
    blobs.push(blob);
  }
  return blobs.sort((a, b) => b.length - a.length);
}
const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
function hullPerimeter(points) {
  points.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const half = sequence => {
    const hull = [];
    for (const p of sequence) {
      while (hull.length >= 2 && cross(hull.at(-2), hull.at(-1), p) <= 0) hull.pop();
      hull.push(p);
    }
    return hull.slice(0, -1);
  };
  const hull = [...half(points), ...half([...points].reverse())];
  return hull.reduce((sum, p, i) => sum + Math.hypot(p[0] - hull[(i + 1) % hull.length][0], p[1] - hull[(i + 1) % hull.length][1]), 0);
}
function outerBoundary(blob, width, height) {
  // Padding gives the outside flood a seed even when the subject touches edges.
  const w = width + 2, h = height + 2, main = new Uint8Array(w * h), outside = new Uint8Array(w * h);
  for (const i of blob) main[(Math.floor(i / width) + 1) * w + i % width + 1] = 1;
  const queue = [0]; outside[0] = 1;
  for (let at = 0; at < queue.length; at++) {
    const i = queue[at], x = i % w, y = Math.floor(i / w);
    for (const [nx, ny] of [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]]) {
      const n = ny * w + nx;
      if (nx >= 0 && nx < w && ny >= 0 && ny < h && !main[n] && !outside[n]) { outside[n] = 1; queue.push(n); }
    }
  }
  let length = 0;
  const corners = new Map();
  for (let y = 1; y <= height; y++) for (let x = 1; x <= width; x++) {
    const i = y * w + x;
    if (outside[i]) continue; // all non-outside cells include filled holes
    const edges = [i - 1, i + 1, i - w, i + w].filter(n => outside[n]).length;
    length += edges;
    // Hull of the boundary pixels' unit squares: a filled rectangle has ratio 1,
    // without the small-box bias of using only pixel centres.
    if (edges) for (const [cx, cy] of [[x, y], [x + 1, y], [x, y + 1], [x + 1, y + 1]]) corners.set(cy * (w + 1) + cx, [cx, cy]);
  }
  return { boundaryLength: length, hullPerimeter: hullPerimeter([...corners.values()]) };
}

/** Blob counts diagnose matte quality only; checkFaces is the person authority. */
export function matteQuality(alpha) {
  if (!validGrid(alpha)) return bad('invalid_mask');
  const grid = binaryGrid(alpha), blobs = components(grid), main = blobs[0];
  if (!main) return bad('no_person');
  const area = blobs.reduce((sum, blob) => sum + blob.length, 0), coverage = area / grid.data.length;
  if (coverage < MATTE_MIN_COVERAGE || coverage > MATTE_MAX_COVERAGE) return { ...bad('person_coverage'), coverage };
  if ((blobs[1]?.length || 0) / main.length >= MATTE_MAX_STRAY_COMPONENT || (area - main.length) / main.length >= MATTE_MAX_STRAY_TOTAL) return { ...bad('busy_background'), coverage };
  const boundary = outerBoundary(main, grid.width, grid.height);
  const raggedness = boundary.boundaryLength / boundary.hullPerimeter;
  return { ...(raggedness > MATTE_MAX_RAGGEDNESS ? bad('ragged_matte') : { ok: true }), coverage, raggedness, ...boundary };
}
export const coverageOk = alpha => matteQuality(alpha);

const validBox = b => b && [b.x, b.y, b.width, b.height].every(Number.isFinite) && b.x >= 0 && b.y >= 0 && b.width > 0 && b.height > 0;
// `minSide` (pixels) replaces the relative 5% floor only for the full-body path (amendment 18); the default is unchanged.
export function checkFaces(faces, imageSize, minSide = FACE_MIN_SIDE * Math.min(imageSize?.width, imageSize?.height)) {
  if (!validSize(imageSize) || !Array.isArray(faces)) return bad('invalid_face');
  if (!faces.length) return bad('no_face');
  // Every second detection blocks, including >=20% secondary faces, smaller
  // background faces and poster faces. No probability/area exemption.
  if (faces.length > 1) return bad('several_people');
  const face = faces[0];
  if (!validBox(face) || face.x + face.width > imageSize.width || face.y + face.height > imageSize.height) return bad('invalid_face');
  if (Math.min(face.width, face.height) < minSide) return bad('face_too_small');
  return { ok: true, faceBox: { ...face } };
}

/** Server mirror, intentionally not imported by server code. */
export function checkOutputSize(size, kind = 'frontal') {
  if (!['frontal', 'crop'].includes(kind) || !validSize(size) || Math.min(size.width, size.height) < 300
      || size.width / size.height < .40 || size.width / size.height > 2.50
      || Math.max(size.width, size.height) > (kind === 'crop' ? 1024 : 1536)) return bad('template_swap_image_size');
  return { ok: true };
}
export function outputSize(size, kind = 'frontal') {
  if (!['frontal', 'crop'].includes(kind) || !validSize(size) || Math.min(size.width, size.height) < 300
      || size.width / size.height < .40 || size.width / size.height > 2.50) return bad('template_swap_image_size');
  const cap = kind === 'crop' ? 1024 : 1536;
  const scale = Math.min(1, cap / Math.max(size.width, size.height));
  const output = { width: Math.round(size.width * scale), height: Math.round(size.height * scale) };
  // Pixel rounding must stay inside both inclusive server aspect boundaries.
  output.width = Math.max(output.width, Math.ceil(output.height * .40));
  output.height = Math.max(output.height, Math.ceil(output.width / 2.50));
  return { ...checkOutputSize(output, kind), ...output };
}

/** Boxes use original, orientation-corrected pixel coordinates. Body extent
 * guides allocation of ratio padding; the accepted face anchors the crop.
 * Padding grows the crop, never removes face pixels. Tiny sources are refused. */
export function headShouldersBox(faceBox, bodyBox, imageSize, minFaceSide) {
  if (!validSize(imageSize) || Math.min(imageSize.width, imageSize.height) < 300) return bad('template_swap_image_size');
  const face = minFaceSide === undefined ? checkFaces([faceBox], imageSize) : checkFaces([faceBox], imageSize, minFaceSide);
  if (!face.ok) return face;
  if (bodyBox && !validBox(bodyBox)) return bad('invalid_mask');
  const { x, y, width: fw, height: fh } = faceBox;
  const left = Math.max(0, x + fw / 2 - fw * 1.3), right = Math.min(imageSize.width, x + fw / 2 + fw * 1.3);
  const top = Math.max(0, y - fh * .8);
  const bottom = Math.min(imageSize.height, y + fh * 3.2);
  let width = right - left, height = bottom - top;
  width = Math.max(width, height * .75); height = Math.max(height, width / 1.33);
  if (width > imageSize.width || height > imageSize.height) return bad('template_swap_image_size');
  // Round outward; keep inclusive ratio limits despite pixel quantisation.
  width = Math.ceil(width); height = Math.ceil(height);
  width = Math.max(width, Math.ceil(height * .75)); height = Math.max(height, Math.ceil(width / 1.33));
  if (width > imageSize.width || height > imageSize.height) return bad('template_swap_image_size');
  // Bias only the added padding toward the body, while containing the full
  // face-derived rectangle. A merged foreground box never replaces the face.
  const centre = bodyBox ? bodyBox.x + bodyBox.width / 2 : (left + right) / 2;
  const paddedLeft = clamp(centre - width / 2, right - width, left);
  const box = { x: Math.floor(clamp(paddedLeft, 0, imageSize.width - width)),
    y: Math.floor(clamp((top + bottom - height) / 2, 0, imageSize.height - height)), width, height };
  const scale = Math.min(1024 / Math.max(width, height), Math.max(1, 512 / Math.min(width, height)));
  const output = { width: Math.round(width * scale), height: Math.round(height * scale) };
  return { ...checkOutputSize(output, 'crop'), box, output };
}

/** Rotation is clockwise, after EXIF orientation has been determined by the
 * adapter. Mapping uses image edges (0..width), not pixel-centre coordinates. */
export function inputTransform(original, rotation = 0) {
  if (!validSize(original) || ![0, 90, 180, 270].includes(rotation)) return bad('invalid_image');
  if (Math.max(original.width, original.height) > 12000 || original.width * original.height > 60000000) return bad('photo_too_large');
  const sideways = rotation === 90 || rotation === 270;
  const orientedWidth = sideways ? original.height : original.width, orientedHeight = sideways ? original.width : original.height;
  const scale = Math.min(1, 1536 / Math.max(orientedWidth, orientedHeight));
  const width = Math.max(1, Math.round(orientedWidth * scale)), height = Math.max(1, Math.round(orientedHeight * scale));
  return { ok: true, original: { ...original }, rotation, width, height, scaleX: width / orientedWidth, scaleY: height / orientedHeight };
}
export function mapPoint(point, transform, direction = 'toOriginal') {
  if (!transform?.ok || !['toOriginal', 'toInput'].includes(direction) || ![point?.x, point?.y].every(Number.isFinite)) throw new Error('invalid_transform');
  const { original: { width: w, height: h }, rotation, scaleX, scaleY } = transform;
  let { x, y } = point;
  if (direction === 'toOriginal') {
    x /= scaleX; y /= scaleY;
    if (rotation === 90) return { x: y, y: h - x };
    if (rotation === 180) return { x: w - x, y: h - y };
    if (rotation === 270) return { x: w - y, y: x };
    return { x, y };
  }
  if (rotation === 90) [x, y] = [h - y, x];
  else if (rotation === 180) [x, y] = [w - x, h - y];
  else if (rotation === 270) [x, y] = [y, w - x];
  return { x: x * scaleX, y: y * scaleY };
}
export function mapBox(box, transform, direction = 'toOriginal') {
  if (!validBox(box)) throw new Error('invalid_transform');
  const points = [[box.x, box.y], [box.x + box.width, box.y], [box.x, box.y + box.height], [box.x + box.width, box.y + box.height]]
    .map(([x, y]) => mapPoint({ x, y }, transform, direction));
  const xs = points.map(p => p.x), ys = points.map(p => p.y), x = Math.min(...xs), y = Math.min(...ys);
  return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
}
