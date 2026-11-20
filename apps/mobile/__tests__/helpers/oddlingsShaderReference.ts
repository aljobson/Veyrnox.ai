// Independent CPU reference for WebGL's portrait-space sampling and body/head warps.
const smooth = (a: number, b: number, v: number) => {
    const t = Math.max(0, Math.min(1, (v - a) / (b - a)));
    return t * t * (3 - 2 * t);
};
const zone = (point: number[], ellipse: number[]) => {
    const x = (point[0] - ellipse[0]) / ellipse[2], y = (point[1] - ellipse[1]) / ellipse[3];
    return { x, y, weight: Math.max(0, 1 - x * x - y * y) ** 2 };
};
const sample = (bytes: Uint8Array, x: number, y: number) => {
    x = Math.max(0, Math.min(1023, x - 0.5)); y = Math.max(0, Math.min(1535, y - 0.5));
    const ix = Math.floor(x), iy = Math.floor(y), dx = x - ix, dy = y - iy;
    return [0, 1, 2, 3].map(c => {
        const at = (px: number, py: number) => bytes[(Math.min(1535, py) * 1024 + Math.min(1023, px)) * 4 + c] / 255;
        return at(ix, iy) * (1 - dx) * (1 - dy) + at(ix + 1, iy) * dx * (1 - dy)
            + at(ix, iy + 1) * (1 - dx) * dy + at(ix + 1, iy + 1) * dx * dy;
    });
};
export function expectedPuppetPixel(plate: Uint8Array, head: Uint8Array, u: Record<string, number[]>, x: number, y: number) {
    const scale = Math.max(u.viewSize[0] / 1024, u.viewSize[1] / 1536);
    const point = [(x + 0.5 - u.viewSize[0] / 2) / scale + 512, (y + 0.5 - u.viewSize[1] / 2) / scale + 768];
    const chest = zone(point, u.chest), lower = zone(point, u.lower);
    const body = point.map((v, c) => v - (v - u.chest[c]) * u.pose[1] * chest.weight);
    body[0] -= u.pose2[3] * 12 * chest.weight;
    body[1] -= Math.abs(u.pose2[2]) * 5 * chest.weight;
    for (const [i, arm] of [u.arm0, u.arm1].entries()) {
        const z = zone(point, arm), reach = 0.45 + 0.55 * smooth(-1, 1, z.y);
        body[0] -= (i ? -1 : 1) * u.pose2[0] * 26 * reach * z.weight;
        body[1] -= Math.abs(u.pose2[0]) * 7 * z.weight;
    }
    body[0] -= u.pose2[1] * 14 * lower.weight;
    body[1] -= u.pose2[2] * 10 * (smooth(-0.18, 0.18, lower.x) * 2 - 1) * lower.weight;
    const color = sample(plate, body[0], body[1]);
    const c = Math.cos(u.pose[2]), s = Math.sin(u.pose[2]);
    const dx = point[0] - u.pivot[0], dy = point[1] - u.pivot[1] - u.pose[3] * smooth(0, 80, u.pivot[1] - point[1]);
    const source = [c * dx + s * dy + u.pivot[0], -s * dx + c * dy + u.pivot[1]];
    const face = sample(head, source[0], source[1]);
    let faceColor = face.slice(0, 3).map(v => v / Math.max(face[3], 1 / 255));
    for (let i = 0; i < 2; i++) {
        const eye = u[`eye${i}`], lid = u[`lid${i}`];
        const ex = (source[0] - eye[0]) / eye[2], ey = (source[1] - eye[1]) / eye[3];
        const coverage = (1 - smooth(1.02, 1.3, Math.hypot(ex, ey))) * u.pose[0];
        const seam = (1 - smooth(0.06, 0.19, Math.abs(ey - 0.12 * ex * ex))) * (1 - smooth(0.8, 1, Math.abs(ex)));
        faceColor = faceColor.map((v, k) => v * (1 - coverage) + lid[k] * (1 - 0.58 * seam) * coverage);
    }
    return [...faceColor.map((v, i) => Math.round(255 * (color[i] * (1 - face[3]) + v * face[3]))), 255];
}
