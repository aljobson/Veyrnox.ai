import type { Skia, SkCanvas, SkImage } from '@shopify/react-native-skia';
import type { DrawOp } from './drawOnImage';

// Skia 2.14 enum values; keeping runtime native imports in the lazy screen only.
const STROKE = 1, ROUND = 1, FILL = 0, CLEAR = 0, PNG = 4, INTERSECT = 1;

export function drawOps(skia: typeof Skia, canvas: SkCanvas, image: SkImage, ops: readonly DrawOp[], scale: number): void {
    canvas.save();
    try {
        canvas.scale(scale, scale);
        // Clip edge strokes identically in the letterboxed preview and the pixel-sized export.
        canvas.clipRect({ x: 0, y: 0, width: image.width(), height: image.height() }, INTERSECT, false);
        canvas.drawImage(image, 0, 0);
        canvas.saveLayer();
        try {
            for (const op of ops) {
                const paint = skia.Paint();
                try {
                    paint.setAntiAlias(true);
                    paint.setColor(skia.Color(op.color));
                    paint.setStyle(STROKE);
                    paint.setStrokeCap(ROUND);
                    paint.setStrokeJoin(ROUND);
                    paint.setStrokeWidth(op.kind === 'box' ? op.strokeWidth : op.width);
                    if (op.kind === 'erase') paint.setBlendMode(CLEAR);
                    if (op.kind === 'box') {
                        canvas.drawRect({ x: op.x, y: op.y, width: op.width, height: op.height }, paint);
                    } else if (op.points.length === 1) {
                        paint.setStyle(FILL);
                        canvas.drawCircle(op.points[0].x, op.points[0].y, op.width / 2, paint);
                    } else if (op.points.length) {
                        const builder = skia.PathBuilder.Make();
                        try {
                            builder.moveTo(op.points[0].x, op.points[0].y);
                            for (const p of op.points.slice(1)) builder.lineTo(p.x, p.y);
                            const path = builder.detach();
                            try { canvas.drawPath(path, paint); } finally { path.dispose(); }
                        } finally { builder.dispose(); }
                    }
                } finally { paint.dispose(); }
            }
        } finally { canvas.restore(); }
    } finally { canvas.restore(); }
}

// The caller owns the working image; this function owns the surface and export snapshot.
export function exportDrawing(skia: typeof Skia, image: SkImage, ops: readonly DrawOp[]): Uint8Array {
    const surface = skia.Surface.Make(image.width(), image.height());
    if (!surface) throw new Error('draw_export_failed');
    try {
        drawOps(skia, surface.getCanvas(), image, ops, 1);
        surface.flush();
        const snapshot = surface.makeImageSnapshot();
        try {
            const bytes = snapshot.encodeToBytes(PNG);
            if (!bytes) throw new Error('draw_export_failed');
            return bytes;
        } finally { snapshot.dispose(); }
    } finally { surface.dispose(); }
}
