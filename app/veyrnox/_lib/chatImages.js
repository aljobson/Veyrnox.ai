// Browser-side rules for chat images (ADR-0068). The pure parts are tested without a DOM; prepareImage needs one.

export const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp'];

/** PNG, JPEG or WebP only. The server checks the real bytes again; this keeps the picker honest. */
export function isImageFile(file) {
  return !!file && IMAGE_TYPES.includes(file.type);
}

/** Scale to fit the long edge, never up, and never to a zero side. */
export function scaledSize(width, height, maxEdge) {
  const w = Math.max(1, Math.round(width) || 1);
  const h = Math.max(1, Math.round(height) || 1);
  const longest = Math.max(w, h);
  if (longest <= maxEdge) return { width: w, height: h };
  const k = maxEdge / longest;
  return { width: Math.max(1, Math.round(w * k)), height: Math.max(1, Math.round(h * k)) };
}

/** How many more files fit under the cap. */
export function addableCount(have, max) {
  return Math.max(0, max - have);
}

/** What a sent attachment is called in the thread: its size, never its file name. */
export function attachmentLabel(a) {
  return a && a.width && a.height ? `Image, ${a.width} by ${a.height}` : 'Image';
}

/**
 * The file to upload: always a copy drawn on a canvas, scaled down when the long edge is over the cap. Image cost follows
 * pixel size, so the server refuses a long edge over the cap; scaling here means a phone photo just works. Redrawing even a
 * picture that already fits is what drops its EXIF block (camera, time, GPS position), which the original file carries and
 * which would otherwise go to storage and the model provider.
 * Throws Error('image_unreadable') when the browser cannot decode it.
 */
export async function prepareImage(file, maxEdge) {
  let bitmap;
  // 'from-image' applies the camera's rotation now, because the redraw below drops the tag that says it.
  try { bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' }); } catch { throw new Error('image_unreadable'); }
  try {
    const target = scaledSize(bitmap.width, bitmap.height, maxEdge);
    const canvas = document.createElement('canvas');
    canvas.width = target.width; canvas.height = target.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('image_unreadable');
    ctx.drawImage(bitmap, 0, 0, target.width, target.height);
    // PNG and WebP keep their type (transparency); everything else is redrawn as JPEG.
    const type = file.type === 'image/png' || file.type === 'image/webp' ? file.type : 'image/jpeg';
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, type, 0.9));
    if (!blob) throw new Error('image_unreadable');
    return new File([blob], file.name, { type });
  } finally {
    if (bitmap.close) bitmap.close();
  }
}
