// 2D wig overlay (ADR-0335, S5b). The SAME fit maths as web (shared/wigFit.js), drawn by Skia as a clipped, tinted image layer.
// A wig never removes or reconstructs the photographed hair: it is drawn over the picture, and natural hair that extends
// beyond the wig stays visible (the coverage hint says so). Stylised placeholder art, not photo-real wigs.
import { Skia, ClipOp, ColorType, AlphaType, type SkCanvas, type SkImage } from '@shopify/react-native-skia';
import { hairRgb, tintMatrix, type Hair, type Wig, type HairMask } from './engine';
import type { Inference } from './protocol';
type Anchor = { landmark: number; position: [number, number] };
type WigArt = { id: string; dimensions: [number, number]; anchors: Anchor[] };
type Fit = { a: number; b: number; tx: number; ty: number };
const fit = require('./shared/wigFit') as {
    fitWig(wig: WigArt, points: Float32Array, w: number, h: number, settings: Wig): Fit | null; protectedFace(points: Float32Array): number[][];
    wigPose(points: Float32Array, w: number, h: number): { fade: number }; wigCoverage(mask: HairMask, alpha: Float32Array, strength: number): { hint: boolean; known: boolean; fraction: number };
    wigEdgeAlpha(alpha: number, confidence: number): number;
};
const { WIGS } = require('./shared/wigs') as { WIGS: readonly WigArt[] };
const { WIG_PNG } = require('./shared/wigAssets') as { WIG_PNG: Record<string, { width: number; height: number; base64: string }> };
const { polygonFromLandmarks, LEFT_EYE, RIGHT_EYE, LEFT_BROW, RIGHT_BROW, LIPS } = require('./shared/regions') as {
    polygonFromLandmarks(points: Float32Array, indices: number[], scale?: number): number[][]; LEFT_EYE: number[]; RIGHT_EYE: number[]; LEFT_BROW: number[]; RIGHT_BROW: number[]; LIPS: number[];
};
export type WigStatus = 'off' | 'face-required' | 'angle' | 'unavailable' | 'ready' | 'coverage-unknown' | 'uncovered' | 'angle-uncovered';
export type WigPlan = { art: WigArt; image: SkImage; pixels: [number, number]; fit: Fit; opacity: number; fade: number; holes: number[][][]; tint: { rgb: number[]; amount: number } | null };
// Decoded once per style. The art is a pre-rendered PNG of the web SVG (see scripts/sync-live-edit.mjs): no SVG parser at run time.
const images = new Map<string, SkImage | null>();
function imageFor(id: string): SkImage | null {
    if (!images.has(id)) {
        const entry = WIG_PNG[id], data = entry ? Skia.Data.fromBase64(entry.base64) : null;
        images.set(id, data ? Skia.Image.MakeImageFromEncoded(data) ?? null : null); data?.dispose();
    }
    return images.get(id) ?? null;
}
/** Everything needed to draw a wig, or the reason there is none. Pure apart from the cached image decode. */
export function planWig(wig: Wig, hair: Hair, inference: Inference | null, w: number, h: number): { status: WigStatus; plan: WigPlan | null } {
    const art = WIGS.find(item => item.id === wig.style);
    if (!art || wig.strength === 0) return { status: 'off', plan: null };
    if (!inference || inference.count !== 1) return { status: 'face-required', plan: null };
    const points = inference.landmarks, pose = fit.wigPose(points, w, h), placed = fit.fitWig(art, points, w, h, wig);
    if (!placed) return { status: 'face-required', plan: null };
    if (pose.fade === 0) return { status: 'angle', plan: null };
    const image = imageFor(art.id);
    if (!image) return { status: 'unavailable', plan: null };
    // Eyes, brows, mouth and the face below the hairline always stay uncovered (same polygons as web).
    const holes = [fit.protectedFace(points), ...[LEFT_EYE, RIGHT_EYE, LEFT_BROW, RIGHT_BROW, LIPS].map(indices => polygonFromLandmarks(points, indices, 1.15))].filter(poly => poly.length);
    return { status: pose.fade < 1 ? 'angle' : 'ready', plan: { art, image, pixels: [WIG_PNG[art.id].width, WIG_PNG[art.id].height], fit: placed, opacity: wig.strength * pose.fade, fade: pose.fade, holes, tint: hair.strength > 0 ? { rgb: hairRgb(hair.shade), amount: hair.strength } : null } };
}
/** Draw into `canvas` in IMAGE pixel space (w x h). `scale` lets the coverage probe reuse this on a small surface. */
export function drawWig(canvas: SkCanvas, plan: WigPlan, w: number, h: number, { tint = true, opacity = plan.opacity } = {}) {
    const paths = plan.holes.map(poly => Skia.Path.Polygon(poly.map(([x, y]) => ({ x: x * w, y: y * h })), true));
    const paint = Skia.Paint();
    try {
        canvas.save();
        paths.forEach(path => canvas.clipPath(path, ClipOp.Difference, true)); // subtraction is from the overlay only, never from the photograph
        const { a, b, tx, ty } = plan.fit;
        canvas.translate(tx, ty); canvas.rotate(Math.atan2(b, a) * 180 / Math.PI, 0, 0); canvas.scale(Math.hypot(a, b), Math.hypot(a, b));
        paint.setAlphaf(Math.max(0, Math.min(1, opacity)));
        if (tint && plan.tint) paint.setColorFilter(Skia.ColorFilter.MakeMatrix(tintMatrix(plan.tint.rgb, plan.tint.amount)));
        canvas.drawImageRect(plan.image, Skia.XYWHRect(0, 0, plan.pixels[0], plan.pixels[1]), Skia.XYWHRect(0, 0, plan.art.dimensions[0], plan.art.dimensions[1]), paint);
        canvas.restore();
    } finally { paint.dispose(); paths.forEach(path => path.dispose()); }
}
/** How much photographed hair the wig leaves visible, using the wig's real silhouette sampled on the hair-mask grid. */
export function wigStatus(wig: Wig, hair: Hair, inference: Inference | null, w: number, h: number): WigStatus {
    const { status, plan } = planWig(wig, hair, inference, w, h);
    if (!plan) return status;
    const mask = inference?.hair;
    if (!mask) return status === 'angle' ? 'angle' : 'coverage-unknown';
    const surface = Skia.Surface.Make(mask.width, mask.height);
    if (!surface) return status === 'angle' ? 'angle' : 'coverage-unknown';
    try {
        surface.getCanvas().clear(Skia.Color('transparent'));
        surface.getCanvas().scale(mask.width / w, mask.height / h);
        drawWig(surface.getCanvas(), plan, w, h, { tint: false, opacity: 1 });
        surface.flush();
        const image = surface.makeImageSnapshot();
        try {
            const pixels = image.readPixels(0, 0, { width: mask.width, height: mask.height, colorType: ColorType.RGBA_8888, alphaType: AlphaType.Unpremul });
            if (!pixels) return status === 'angle' ? 'angle' : 'coverage-unknown';
            const alpha = Float32Array.from(mask.hair, (confidence, i) => fit.wigEdgeAlpha(pixels[i * 4 + 3] / 255, Math.round(confidence * 255) / 255));
            const coverage = fit.wigCoverage(mask, alpha, plan.opacity);
            return plan.fade < 1 ? (coverage.hint ? 'angle-uncovered' : 'angle') : coverage.hint ? 'uncovered' : coverage.known ? 'ready' : 'coverage-unknown';
        } finally { image.dispose(); }
    } finally { surface.dispose(); }
}
