// Frame choice for image-to-video models that take no aspect ratio. fal's Kling 3.0 image-to-video and Crun's kling/v3
// both follow the start image (Crun refuses an aspect_ratio key outright), so the ratio is chosen by centre-cropping the
// image on the person's device before it is uploaded. Nothing here reaches the server, a price or a job input.
export const FRAME_RATIOS = Object.freeze(['16:9', '9:16', '1:1', '4:3', '3:4']);
export const FRAME_MODELS = Object.freeze(['kling-3.0-i2v', 'kling-3.0-standard-i2v']);

/** Models that offer the frame choice (those with a start image and no ratio of their own). */
export const takesFrame = (modelId) => FRAME_MODELS.includes(modelId);

const NEAR = 0.01;

/**
 * Largest centred crop of a width x height image with the given "w:h" ratio, in whole pixels.
 * Returns null when no crop is needed (no ratio, unknown ratio, bad size, or already within 1% of it).
 * @returns {{x:number,y:number,width:number,height:number}|null}
 */
export function cropRect(width, height, ratio) {
  if (!FRAME_RATIOS.includes(ratio) || !(width > 0) || !(height > 0)) return null;
  const [w, h] = ratio.split(':').map(Number);
  const target = w / h;
  const current = width / height;
  if (Math.abs(current - target) / target <= NEAR) return null;
  let cropWidth = width;
  let cropHeight = height;
  if (current > target) cropWidth = Math.max(1, Math.round(height * target));
  else cropHeight = Math.max(1, Math.round(width / target));
  return { x: Math.floor((width - cropWidth) / 2), y: Math.floor((height - cropHeight) / 2), width: cropWidth, height: cropHeight };
}
