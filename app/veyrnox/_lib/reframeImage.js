import { cropRect, takesFrame } from '../../../lib/aspectFrame.mjs';

// Centre-crops an image file to a frame ratio before upload (see lib/aspectFrame.mjs). Anything that cannot be read or
// drawn is sent as it is: the server's own media inspection stays the judge of the source.
export async function reframeImage(file, ratio) {
  if (!ratio || !file?.type?.startsWith('image/')) return file;
  let bitmap;
  try {
    bitmap = await createImageBitmap(file);
    const rect = cropRect(bitmap.width, bitmap.height, ratio);
    if (!rect) return file;
    const canvas = document.createElement('canvas');
    canvas.width = rect.width;
    canvas.height = rect.height;
    canvas.getContext('2d').drawImage(bitmap, rect.x, rect.y, rect.width, rect.height, 0, 0, rect.width, rect.height);
    const type = file.type === 'image/png' ? 'image/png' : 'image/jpeg';
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, type, 0.95));
    if (!blob) return file;
    return new File([blob], file.name || 'image', { type, lastModified: file.lastModified });
  } catch { return file; } finally { bitmap?.close(); }
}

/** The upload function a Create submit uses: the plain one, or one that crops the image to the chosen frame first. */
export const frameUploader = (modelId, frame, upload) => (frame && takesFrame(modelId) ? async (file) => upload(await reframeImage(file, frame)) : upload);
