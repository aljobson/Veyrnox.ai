import { Skia, BlendMode, PaintStyle, StrokeJoin, type SkCanvas } from '@shopify/react-native-skia';
const { protectedFace } = require('./shared/wigFit') as { protectedFace(p: Float32Array): number[][] };
const { polygonFromLandmarks, LEFT_EYE, RIGHT_EYE, LEFT_BROW, RIGHT_BROW, LIPS } = require('./shared/regions') as {
    polygonFromLandmarks(p: Float32Array, indices: number[], scale: number): number[][];
    LEFT_EYE: number[]; RIGHT_EYE: number[]; LEFT_BROW: number[]; RIGHT_BROW: number[]; LIPS: number[];
};
export const faceHoles = (points: Float32Array): number[][][] => [protectedFace(points),
    ...[LEFT_EYE, RIGHT_EYE, LEFT_BROW, RIGHT_BROW, LIPS].map(ids => polygonFromLandmarks(points, ids, 1.15))];

/** Faithful port of web wigCommon.carveFace: destination-out, fill THEN stroke,
 * FOUR OVERLAY pixels, round joins, shared protectedFace and 1.15 feature expansion.
 * Do not scale the stroke with the source photo or substitute a clip (boundary
 * protection is essential when the cached overlay is resampled for export).
 */
export function carveNativeFace(canvas: SkCanvas, width: number, height: number, points: Float32Array): void {
    const paint = Skia.Paint();
    try {
        paint.setAntiAlias(true); paint.setColor(Skia.Color('black')); paint.setBlendMode(BlendMode.DstOut);
        paint.setStrokeWidth(4); paint.setStrokeJoin(StrokeJoin.Round);
        for (const poly of faceHoles(points)) {
            if (!poly.length) continue;
            const path = Skia.Path.Polygon(poly.map(([x, y]) => ({ x: x * width, y: y * height })), true);
            try {
                paint.setStyle(PaintStyle.Fill); canvas.drawPath(path, paint);
                paint.setStyle(PaintStyle.Stroke); canvas.drawPath(path, paint);
            } finally { path.dispose(); }
        }
    } finally { paint.dispose(); }
}

/** R1 deviation: the exact web AA fill/stroke can leave alpha=1/255 INSIDE a
 * polygon (rotated fixture, overlay pixel 174,133). Preserve that exact first
 * pass above, then guarantee zero interior alpha with an un-antialiased clear.
 * The web's expanded features and four-pixel boundary protection stay intact.
 */
export function clearNativeFaceInteriors(canvas: SkCanvas, width: number, height: number, points: Float32Array): void {
    const paint = Skia.Paint();
    try {
        paint.setAntiAlias(false); paint.setBlendMode(BlendMode.Clear); paint.setStyle(PaintStyle.Fill);
        for (const poly of faceHoles(points)) {
            if (!poly.length) continue;
            const path = Skia.Path.Polygon(poly.map(([x, y]) => ({ x: x * width, y: y * height })), true);
            try { canvas.drawPath(path, paint); } finally { path.dispose(); }
        }
    } finally { paint.dispose(); }
}
