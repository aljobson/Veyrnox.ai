import { Skia, VertexMode, BlendMode, FilterMode, MipmapMode, type SkImage } from '@shopify/react-native-skia';
import type { Wig } from './engine';
import type { Overlay3d } from './wig';
import { wigGeometry, type GeometryStats } from './wig3dGeometry';
import { carveNativeFace, clearNativeFaceInteriors } from './wig3dCarve';
const { headFrame, wigMatrix, wig3dFade } = require('./shared/wig3d') as {
    headFrame(points: Float32Array, w: number, h: number): object | null;
    wigMatrix(frame: object, settings: Wig): number[];
    wig3dFade(points: Float32Array, w: number, h: number): number;
};
export type Wig3dJob = { wig: Wig; landmarks: Float32Array; width: number; height: number };
export const overlaySize = (width: number, height: number) => {
    const ratio = Math.min(1, 1024 / Math.max(width, height));
    return { width: Math.max(1, Math.round(width * ratio)), height: Math.max(1, Math.round(height * ratio)) };
};
export const geometryStats = (): GeometryStats => ({ input: 0, kept: 0, dropped: 0, splits: 0, boundaryLeaves: 0, maxBoundaryEdge: 0 });
type Options = { stats?: GeometryStats; beforeCarve?: (image: SkImage) => void };

/** Cooperatively cancellable render: return() releases in-progress native objects.
 * beforeCarve is a synchronous proof observer; its borrowed image is disposed here.
 * The final image is owned by the caller (or transferred to the overlay cache).
 */
export function* nativeWigTask(job: Wig3dJob, options: Options = {}): Generator<void, Overlay3d> {
    const { wig, landmarks, width, height } = job;
    try {
        if (![width, height].every(v => Number.isFinite(v) && v > 0)) return { status: 'face-required', image: null, fade: 1 };
        const frame = headFrame(landmarks, width, height);
        if (!frame) return { status: 'face-required', image: null, fade: 1 };
        const fade = wig3dFade(landmarks, width, height);
        if (fade === 0) return { status: 'angle', image: null, fade };
        const size = overlaySize(width, height), matrix = wigMatrix(frame, wig);
        const triangles = yield* wigGeometry(wig.style, matrix, [size.width / width, size.height / height], options.stats ?? geometryStats());
        // Geometry bounds remain in overlay pixels. Rasterize at 2x, then filter
        // once into the cache-sized image so outer silhouettes/hem have coverage
        // AA without opening seams between the opaque adaptive triangles.
        yield;
        const surface = Skia.Surface.Make(size.width * 2, size.height * 2);
        if (!surface) throw Error('wig-surface');
        try {
            const canvas = surface.getCanvas(), paint = Skia.Paint();
            try {
                canvas.clear(Skia.Color('transparent')); canvas.scale(2, 2); paint.setColor(Skia.Color('white'));
                // Small nonindexed batches avoid uint16 index limits and the CanvasKit
                // colour-array adapter's quadratic concatenation cost. Mesh edges have
                // no AA, avoiding transparent seams between adaptive neighbouring faces.
                paint.setAntiAlias(false);
                for (let start = 0; start < triangles.length; start += 256) {
                    yield;
                    const vertices = triangles.slice(start, start + 256).flat();
                    const mesh = Skia.MakeVertices(VertexMode.Triangles, vertices.map(v => ({ x: v.sx, y: v.sy })),
                        null, vertices.map(v => Float32Array.of(v.r, v.g, v.b, 1)));
                    try { canvas.drawVertices(mesh, BlendMode.Modulate, paint); } finally { mesh.dispose(); }
                }
                yield;
                surface.flush();
                const highResolution = surface.makeImageSnapshot();
                try {
                    yield;
                    const overlay = Skia.Surface.Make(size.width, size.height);
                    if (!overlay) throw Error('wig-downsample-surface');
                    try {
                        const output = overlay.getCanvas(); output.clear(Skia.Color('transparent'));
                        output.drawImageRectOptions(highResolution, Skia.XYWHRect(0, 0, size.width * 2, size.height * 2),
                            Skia.XYWHRect(0, 0, size.width, size.height), FilterMode.Linear, MipmapMode.None, paint);
                        yield;
                        if (options.beforeCarve) {
                            overlay.flush(); const raw = overlay.makeImageSnapshot();
                            try { options.beforeCarve(raw); } finally { raw.dispose(); }
                        }
                        // Carve AFTER downsampling; filtering must never restore
                        // alpha inside the protected polygon interiors.
                        carveNativeFace(output, size.width, size.height, landmarks);
                        clearNativeFaceInteriors(output, size.width, size.height, landmarks);
                        yield;
                        overlay.flush(); const snapshot = overlay.makeImageSnapshot();
                        try {
                            yield;
                            const image = snapshot.makeNonTextureImage();
                            if (!image) throw Error('wig-readback');
                            return { status: 'ready', image, fade };
                        } finally { snapshot.dispose(); }
                    } finally { overlay.dispose(); }
                } finally { highResolution.dispose(); }
            } finally { paint.dispose(); }
        } finally { surface.dispose(); }
    } catch { return { status: 'unavailable', image: null, fade: 1 }; }
}

/** Synchronous CanvasKit/proof entry point. UI uses the yielding task above. */
export function renderNativeWig(job: Wig3dJob, options: Options = {}): Overlay3d {
    const task = nativeWigTask(job, options);
    let next = task.next(); while (!next.done) next = task.next();
    return next.value;
}
