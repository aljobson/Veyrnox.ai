import { protectedFace, wigCoverage, wigEdgeAlpha } from '../../../../packages/live-edit/wigFit.js';
import { polygonFromLandmarks, LEFT_EYE, RIGHT_EYE, LEFT_BROW, RIGHT_BROW, LIPS } from '../../../../packages/live-edit/regions.js';

/** Subtraction is ONLY from the overlay: the face below the hairline, eyes, brows and lips stay on top. The photo is never masked. */
export function carveFace(ctx, layer, points) {
    const polygon = vertices => {
        if (!vertices.length) return;
        ctx.beginPath(); vertices.forEach(([x, y], i) => i ? ctx.lineTo(x * layer.width, y * layer.height) : ctx.moveTo(x * layer.width, y * layer.height));
        ctx.closePath(); ctx.fill(); ctx.stroke();
    };
    ctx.save(); ctx.globalCompositeOperation = 'destination-out'; ctx.fillStyle = '#000'; ctx.strokeStyle = '#000'; ctx.lineWidth = 4; ctx.lineJoin = 'round';
    polygon(protectedFace(points));
    for (const indices of [LEFT_EYE, RIGHT_EYE, LEFT_BROW, RIGHT_BROW, LIPS]) polygon(polygonFromLandmarks(points, indices, 1.15));
    ctx.restore();
}

/** How much natural hair the wig leaves showing, sampled on the hair-mask grid. */
export function sampleCoverage(layer, sample, mask, opacity) {
    if (!mask) return { known: false, hint: false, fraction: 0 };
    sample.width = mask.width; sample.height = mask.height;
    const sc = sample.getContext('2d', { willReadFrequently: true }); sc.drawImage(layer, 0, 0, sample.width, sample.height);
    const data = sc.getImageData(0, 0, sample.width, sample.height).data;
    return wigCoverage(mask, Float32Array.from(mask.hair, (_, i) => wigEdgeAlpha(data[i * 4 + 3] / 255, Math.round(mask.hair[i] * 255) / 255)), opacity);
}
