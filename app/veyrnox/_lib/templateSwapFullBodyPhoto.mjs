import { inputTransform, personAlpha, matteQuality, headShouldersBox, outputSize, checkOutputSize } from '../../../lib/templateSwapCutout.mjs';
import { fullBodyDecodeSize, faceSearchBox, detectSize, landmarkBox, checkFullBodyFace, faceCropBox, headHint, FULL_BODY_MIN_FACE_PX } from '../../../lib/templateSwapFullBodyGeometry.mjs';
import { photoHeader, greyCutout, png, checkAbort, requireOk } from './templateSwapPhoto.mjs';
import { createVisionProcessor } from './editorVisionWorkerClient.mjs';
import { createFaceProcessor } from './liveEdit/faceClient.mjs';

// Full-body swap photo (ADR-0351 amendment 18). The face detector looks at 384 px, so a standing person's face is too small
// to find on the whole photo. Steps: decode a 1536 px working copy (person matte, full-body cut-out) and a high-resolution
// copy (up to 4096 px / 12 MP); find the face again on a high-resolution crop of the head region; refuse a face under 96 px
// in the original photo; cut out a tight face crop and a head-and-shoulders crop from the high-resolution copy, each with its
// own person matte. Output order = request order: [face (frontal), head-and-shoulders, full body].
const box = (b, scale) => ({ x: b.x * scale, y: b.y * scale, width: b.width * scale, height: b.height * scale });

// The segmenter runs in VIDEO mode: every call needs a larger timestamp than the last (0 = working copy, then 1, 2).
async function cutoutRegion(hi, region, output, vision, decode, signal, timestamp) {
  const picture = await decode(hi, region.x, region.y, region.width, region.height, { resizeWidth: output.width, resizeHeight: output.height, resizeQuality: 'high' });
  try {
    checkAbort(signal);
    const alpha = personAlpha(await vision.segment(picture, timestamp)); checkAbort(signal);
    const c = greyCutout(picture, alpha, output);
    try { return await png(c); } finally { c.width = c.height = 1; }
  } finally { picture.close?.(); }
}

async function findFace(face, hi, region, decode, signal) {
  const size = detectSize(region);
  const picture = await decode(hi, region.x, region.y, region.width, region.height, { resizeWidth: size.width, resizeHeight: size.height, resizeQuality: 'high' });
  try { checkAbort(signal); return await face.detect(picture); } finally { picture.close?.(); }
}

export async function processFullBodyPhoto(file, { signal, deps = {} } = {}) {
  checkAbort(signal);
  const header = await (deps.header || photoHeader)(file); checkAbort(signal);
  const transform = requireOk(inputTransform(header, header.rotation || 0));
  requireOk(outputSize(transform));
  const sideways = [90, 270].includes(transform.rotation);
  const hiSize = requireOk(fullBodyDecodeSize(sideways ? { width: header.height, height: header.width } : { width: header.width, height: header.height }));
  const decode = deps.bitmap || createImageBitmap, crop = deps.crop || createImageBitmap, encodeRegion = deps.encodeRegion || cutoutRegion;
  let bitmap, hi, vision, face;
  try {
    bitmap = await decode(file, { imageOrientation: 'from-image', resizeWidth: transform.width, resizeHeight: transform.height, resizeQuality: 'high' });
    checkAbort(signal);
    if (bitmap.width !== transform.width || bitmap.height !== transform.height) throw Error('invalid_image');
    vision = await (deps.vision || createVisionProcessor)({ signal }); checkAbort(signal);
    face = await (deps.face || createFaceProcessor)({ signal }); checkAbort(signal);
    const first = await face.detect(bitmap); checkAbort(signal);
    if (first?.count >= 2) throw Error('several_people');
    const masks = await vision.segment(bitmap, 0); checkAbort(signal);
    const alpha = personAlpha(masks); requireOk(matteQuality(alpha));
    hi = await decode(file, { imageOrientation: 'from-image', resizeWidth: hiSize.width, resizeHeight: hiSize.height, resizeQuality: 'high' });
    checkAbort(signal);
    if (hi.width !== hiSize.width || hi.height !== hiSize.height) throw Error('invalid_image');
    // Working copy -> high-resolution pixels.
    // The segmenter's 'body' class is skin only; the person box comes from the background class, the head from the face class.
    const rough = first?.count === 1 ? landmarkBox(first, { x: 0, y: 0, width: hi.width, height: hi.height }) : null;
    const hint = headHint(rough, masks, hiSize), body = hint.person;
    const region = faceSearchBox(hint.face, body, hiSize);
    if (!region) throw Error('no_face');
    const second = await findFace(face, hi, region, crop, signal); checkAbort(signal);
    if (second?.count >= 2) throw Error('several_people');
    const found = landmarkBox(second, region) || rough;
    if (!found) throw Error('no_face');
    // hiSize.scale maps original photo pixels to high-resolution pixels: the 96 px rule is about the original photo.
    const { faceBox } = requireOk(checkFullBodyFace(found, hiSize, hiSize.scale));
    const faceCrop = requireOk(faceCropBox(faceBox, hiSize));
    const shoulders = requireOk(headShouldersBox(faceBox, body, hiSize, FULL_BODY_MIN_FACE_PX * hiSize.scale));
    requireOk(checkOutputSize(faceCrop.output, 'crop'));
    const faceFile = await encodeRegion(hi, faceCrop.box, faceCrop.output, vision, crop, signal, 1); checkAbort(signal);
    const shouldersFile = await encodeRegion(hi, shoulders.box, shoulders.output, vision, crop, signal, 2); checkAbort(signal);
    const wholeSize = requireOk(outputSize(bitmap));
    const whole = await (deps.encodeWhole || (async () => { const c = greyCutout(bitmap, alpha, wholeSize); try { return await png(c); } finally { c.width = c.height = 1; } }))();
    checkAbort(signal);
    const files = [faceFile, shouldersFile, whole];
    if (files.some(f => f?.type !== 'image/png' || f.size > 20 * 1024 * 1024)) throw Error('invalid_image');
    return { files, transform: { ...transform, orientation: header.orientation || 1 }, faceBox: box(faceBox, 1 / hiSize.scale) };
  } finally { face?.close(); vision?.close(); hi?.close(); bitmap?.close(); }
}
