import { OVAL, LEFT_EYE, RIGHT_EYE, LEFT_BROW, RIGHT_BROW, LIPS, INNER_LIPS } from '../../packages/live-edit/regions.js';
import { WIGS } from '../../packages/live-edit/wigs.js';
// Original synthetic geometry. No real photo or licensed third-party art.
export function wigPoints() {
    const points = new Float32Array(1434);
    const put = (id, x, y) => { points[id * 3] = x / 256; points[id * 3 + 1] = y / 256; };
    const ellipse = (ids, x, y, rx, ry, start = 0) => ids.forEach((id, i) => { const a = i / ids.length * 2 * Math.PI + start; put(id, x + rx * Math.cos(a), y + ry * Math.sin(a)); });
    ellipse(OVAL, 128, 139, 56, 71, -Math.PI / 2);
    ellipse(LEFT_EYE, 151, 121, 12, 5); ellipse(RIGHT_EYE, 105, 121, 12, 5);
    ellipse(LEFT_BROW, 151, 108, 15, 3); ellipse(RIGHT_BROW, 105, 108, 15, 3);
    ellipse(LIPS, 128, 173, 18, 7); ellipse(INNER_LIPS, 128, 173, 10, 3);
    put(1, 128, 146);
    for (const anchor of WIGS[0].anchors) put(anchor.landmark, anchor.position[0] * .4 + 25.6, anchor.position[1] * .4);
    return points;
}
export function longHairMask() {
    const width = 64, height = 64, hair = new Float32Array(width * height);
    for (let y = 12; y < 60; y++) for (let x = 12; x < 52; x++) {
        if (y < 21 || x < 18 || x >= 46) hair[y * width + x] = 1;
    }
    return { width, height, hair };
}
export function wigFixture() {
    const source = document.createElement('canvas'); source.width = source.height = 256;
    const ctx = source.getContext('2d'), mask = longHairMask();
    ctx.fillStyle = '#b0c0d0'; ctx.fillRect(0, 0, 256, 256);
    ctx.fillStyle = '#303030';
    for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) if (mask.hair[y * 64 + x]) ctx.fillRect(x * 4, y * 4, 4, 4);
    ctx.fillStyle = '#c09070'; ctx.fillRect(80, 96, 96, 104);
    ctx.fillStyle = '#204050'; ctx.fillRect(96, 118, 18, 6); ctx.fillRect(142, 118, 18, 6);
    ctx.fillStyle = '#402010'; ctx.fillRect(93, 105, 24, 5); ctx.fillRect(139, 105, 24, 5);
    ctx.fillStyle = '#a06050'; ctx.fillRect(123, 140, 10, 12); ctx.fillRect(116, 170, 24, 6);
    return { source, points: wigPoints(), mask };
}
