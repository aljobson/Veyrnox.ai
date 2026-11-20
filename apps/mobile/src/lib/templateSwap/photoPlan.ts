import { inputTransform, outputSize, personAlpha, matteQuality, headShouldersBox, resampleAlpha, type Size, type Box, type Masks, type Result } from '../../../../../lib/templateSwapCutout.mjs';
import { faceBoxFromResult } from '../../../../../app/veyrnox/_lib/templateSwapClient.mjs';
export function requireOk<T>(result: Result<T>): T & { ok: true } {
    if (!result.ok) throw Error(result.error === 'template_swap_image_size' ? 'photo_too_small' : result.error);
    return result;
}
export function originalSize(size: Partial<Size> | null): Size {
    if (!size || !Number.isInteger(size.width) || !Number.isInteger(size.height) || Number(size.width) <= 0 || Number(size.height) <= 0) throw Error('invalid_image');
    const { width, height } = size as Size;
    if (width > 8192 || height > 8192 || width * height > 24_000_000) throw Error('photo_too_large');
    requireOk(outputSize(requireOk(inputTransform({ width, height }))));
    return { width, height };
}
export function bodyBounds(masks: Masks, size: Size): Box | null {
    if (!masks.body) return null;
    let left = masks.width, top = masks.height, right = -1, bottom = -1;
    for (let y = 0; y < masks.height; y++) for (let x = 0; x < masks.width; x++) if (masks.body[y * masks.width + x] >= .5) {
        left = Math.min(left, x); top = Math.min(top, y); right = Math.max(right, x); bottom = Math.max(bottom, y);
    }
    return right < left ? null : { x: left * size.width / masks.width, y: top * size.height / masks.height, width: (right - left + 1) * size.width / masks.width, height: (bottom - top + 1) * size.height / masks.height };
}
export function compositePlan(size: Size, detected: { count: number; landmarks: Float32Array }, masks: Masks) {
    const frontal = requireOk(outputSize(size));
    const { faceBox } = requireOk(faceBoxFromResult(detected, frontal));
    const alpha = personAlpha(masks), quality = matteQuality(alpha);
    if (!quality.ok) throw Error(['no_person', 'person_coverage'].includes(quality.error) ? 'busy_background' : quality.error);
    const crop = requireOk(headShouldersBox(faceBox, bodyBounds(masks, frontal), frontal));
    const cropSize = requireOk(outputSize(crop.output, 'crop'));
    const matte = resampleAlpha(alpha, frontal, 2);
    const rgba = new Uint8Array(matte.data.length * 4);
    for (let i = 0; i < matte.data.length; i++) rgba[i * 4 + 3] = Math.round(matte.data[i] * 255);
    return { frontal, crop: cropSize, cropBox: crop.box, faceBox, rgba, background: '#808080', blend: 'DstIn' as const };
}
export type CompositePlan = ReturnType<typeof compositePlan>;
