// Mirror of lib/aspectFrame.mjs (the web Create chip). fal's Kling 3.0 image-to-video and Crun's kling/v3 follow the start
// image (Crun refuses an aspect_ratio key), so the ratio is chosen by centre-cropping the photo before it is uploaded.
// Nothing here reaches the server, a price or a job input.
export const FRAME_RATIOS: readonly string[] = ['16:9', '9:16', '1:1', '4:3', '3:4'];
export const FRAME_MODELS: readonly string[] = ['kling-3.0-i2v', 'kling-3.0-standard-i2v'];

export const takesFrame = (modelId: string | undefined): boolean => !!modelId && FRAME_MODELS.includes(modelId);

export interface CropRect { readonly originX: number; readonly originY: number; readonly width: number; readonly height: number }

const NEAR = 0.01;

/** Largest centred crop of a width x height image with the given "w:h" ratio, or null when none is needed. */
export function cropRect(width: number, height: number, ratio: string): CropRect | null {
    if (!FRAME_RATIOS.includes(ratio) || !(width > 0) || !(height > 0)) return null;
    const [w, h] = ratio.split(':').map(Number) as [number, number];
    const target = w / h;
    const current = width / height;
    if (Math.abs(current - target) / target <= NEAR) return null;
    let cropWidth = width;
    let cropHeight = height;
    if (current > target) cropWidth = Math.max(1, Math.round(height * target));
    else cropHeight = Math.max(1, Math.round(width / target));
    return { originX: Math.floor((width - cropWidth) / 2), originY: Math.floor((height - cropHeight) / 2), width: cropWidth, height: cropHeight };
}

/** Width over height of a "w:h" frame, for a thumbnail that shows the shape the photo is cropped to. */
export const frameRatio = (ratio: string): number => {
    const [w, h] = ratio.split(':').map(Number) as [number, number];
    const value = w / h;
    // A malformed value gives a square thumbnail, never NaN or Infinity in a style.
    return Number.isFinite(value) && value > 0 ? value : 1;
};
