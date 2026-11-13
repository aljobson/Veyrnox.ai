import { OVAL, LEFT_EYE, RIGHT_EYE, LIPS, LEFT_BROW, RIGHT_BROW, INNER_LIPS, polygonFromLandmarks } from '../../../../packages/live-edit/regions.js';
export function createFaceMask(width, height, points) {
    const mask = document.createElement('canvas'), scale = Math.min(1, 512 / Math.max(width, height));
    mask.width = Math.max(1, Math.round(width * scale)); mask.height = Math.max(1, Math.round(height * scale));
    const ctx = mask.getContext('2d');
    ctx.fillStyle = 'black'; ctx.fillRect(0, 0, mask.width, mask.height);
    function polygon(indices, expansion, color) {
        const vertices = polygonFromLandmarks(points, indices, expansion);
        if (!vertices.length) return;
        ctx.fillStyle = color; ctx.beginPath();
        vertices.forEach(([x, y], i) => i ? ctx.lineTo(x * mask.width, y * mask.height) : ctx.moveTo(x * mask.width, y * mask.height));
        ctx.closePath(); ctx.fill();
    }
    if (points?.length === 478 * 3) {
        if ('filter' in ctx) { ctx.filter = 'blur(1px)'; polygon(OVAL, 0.92, '#ff0000'); }
        else {
            // No canvas filter (older Safari): feather the face edge with three shrinking, increasingly opaque layers.
            for (const [expansion, alpha] of [[0.96, 0.33], [0.94, 0.5], [0.92, 1]]) { ctx.globalAlpha = alpha; polygon(OVAL, expansion, '#ff0000'); }
            ctx.globalAlpha = 1;
        }
        // Hard expanded holes AFTER feathering: no smoothing leaks into eye/brow/mouth.
        ctx.filter = 'none';
        for (const region of [LEFT_EYE, RIGHT_EYE, LIPS, LEFT_BROW, RIGHT_BROW]) polygon(region, 1.5, 'black');
        polygon(INNER_LIPS, 0.85, '#00ff00');
        polygon(LEFT_EYE, 0.85, '#0000ff'); polygon(RIGHT_EYE, 0.85, '#0000ff');
    }
    return mask;
}
