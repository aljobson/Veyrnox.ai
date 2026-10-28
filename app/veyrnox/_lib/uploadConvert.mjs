import { uploadPlan, convertedName } from '../../../lib/uploadInputTypes.mjs';

// Turns a picked HEIC/AVIF/GIF picture into JPEG or PNG and a MOV/WebM clip
// into MP4 (H.264), all in the browser, before it is uploaded. No WebAssembly:
// the CSP has no 'wasm-unsafe-eval', so a picture is decoded only when the
// browser can read it natively (HEIC: Safari), and video goes through
// mediabunny, which uses WebCodecs.

export class UploadConvertError extends Error {
  /** @param {'unsupported_type'|'heic_unreadable'|'image_unreadable'|'video_unreadable'} code */
  constructor(code) {
    super(code);
    this.name = 'UploadConvertError';
    this.code = code;
  }
}

const JPEG_QUALITY = 0.92;

/** True when the file must be converted before upload (callers may show "Converting…"). */
export function needsConversion(file) {
  return Boolean(uploadPlan(file)?.to);
}

/** A file whose type /api/v1/uploads stores. Throws UploadConvertError. */
export async function prepareUpload(file) {
  const plan = uploadPlan(file);
  if (!plan) throw new UploadConvertError('unsupported_type');
  if (!plan.to) return file.type === plan.from ? file : new File([file], file.name, { type: plan.from, lastModified: file.lastModified });
  return plan.kind === 'image' ? convertImage(file, plan) : convertVideo(file, plan);
}

/**
 * Prepare several files at once. Never throws: a file that cannot be prepared
 * is reported, the rest go on.
 * @returns {Promise<{files: File[], failed: {name:string, code:string}[]}>}
 */
export async function prepareUploads(fileList) {
  const files = [], failed = [];
  for (const file of Array.from(fileList || [])) {
    try {
      files.push(await prepareUpload(file));
    } catch (error) {
      failed.push({ name: file?.name || '', code: error instanceof UploadConvertError ? error.code : 'image_unreadable' });
    }
  }
  return { files, failed };
}

async function convertImage(file, plan) {
  let bitmap;
  try {
    bitmap = await createImageBitmap(file); // first frame of a GIF; EXIF orientation applied
  } catch {
    throw new UploadConvertError(plan.from === 'image/heic' || plan.from === 'image/heif' ? 'heic_unreadable' : 'image_unreadable');
  }
  try {
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const context = canvas.getContext('2d');
    if (!context) throw new UploadConvertError('image_unreadable');
    if (plan.to === 'image/jpeg') { context.fillStyle = '#fff'; context.fillRect(0, 0, canvas.width, canvas.height); }
    context.drawImage(bitmap, 0, 0);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, plan.to, JPEG_QUALITY));
    if (!blob || blob.type !== plan.to) throw new UploadConvertError('image_unreadable');
    return new File([blob], convertedName(file.name, plan.to), { type: plan.to });
  } finally {
    bitmap.close();
  }
}

async function convertVideo(file, plan) {
  let input;
  try {
    const { Input, BlobSource, ALL_FORMATS, Output, BufferTarget, Mp4OutputFormat, Conversion } = await import('mediabunny');
    input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
    const output = new Output({ format: new Mp4OutputFormat({ fastStart: 'in-memory' }), target: new BufferTarget() });
    // H.264 is what every video endpoint reads. An H.264 MOV is copied as it
    // is; HEVC or VP8/VP9 is re-encoded. Audio that cannot become AAC is dropped.
    const conversion = await Conversion.init({ input, output, video: { codec: 'avc' }, audio: { codec: 'aac' }, showWarnings: false });
    if (!conversion.isValid || conversion.discardedTracks.some((item) => item.track.type === 'video')) throw new UploadConvertError('video_unreadable');
    await conversion.execute();
    const buffer = output.target.buffer;
    if (!buffer || !buffer.byteLength) throw new UploadConvertError('video_unreadable');
    return new File([buffer], convertedName(file.name, plan.to), { type: plan.to });
  } catch (error) {
    if (error instanceof UploadConvertError) throw error;
    throw new UploadConvertError('video_unreadable');
  } finally {
    input?.dispose?.();
  }
}
