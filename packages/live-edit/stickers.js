// Original hand-authored SVG paths, viewBox 0 0 100 100; owned by Veyrnox.
export const STICKERS = Object.freeze({
    spark: { anchor: 10, path: 'M50 0 L60 36 L96 50 L60 60 L50 100 L40 60 L4 50 L40 36 Z', color: '#32d6c5' },
    heart: { anchor: 205, path: 'M50 90 C-30 40 10 -10 50 25 C90 -10 130 40 50 90 Z', color: '#f578a1' },
    flower: { anchor: 1, path: 'M50 30 C10 -20 -20 30 30 50 C-20 70 10 120 50 70 C90 120 120 70 70 50 C120 30 90 -20 50 30 Z', color: '#c5b3ff' },
});
export function anchoredSticker(kind, landmarks) {
    if (!STICKERS[kind] || landmarks?.length !== 478 * 3) return null;
    const index = STICKERS[kind].anchor * 3;
    return { kind, x: Math.max(0, Math.min(1, landmarks[index])), y: Math.max(0, Math.min(1, landmarks[index + 1])), size: 0.12 };
}
export function drawStickers(ctx, stickers, width, height) {
    for (const item of stickers) {
        const shape = STICKERS[item.kind]; if (!shape) continue;
        const size = item.size * Math.min(width, height);
        ctx.save(); ctx.translate(item.x * width - size / 2, item.y * height - size / 2); ctx.scale(size / 100, size / 100);
        ctx.fillStyle = shape.color; ctx.fill(new Path2D(shape.path)); ctx.restore();
    }
}
