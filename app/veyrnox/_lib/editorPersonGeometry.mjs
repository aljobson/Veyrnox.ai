import {assertPicture} from './editorMotionAnalysis.mjs';
// Original 2D inverse warps, driven by the existing local semantic segmentation model.
const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
export function regionBounds(masks, person, region) {
    if (!person?.found) return null;
    if (region === 'body') return person.bounds;
    let minX = masks.width, minY = masks.height, maxX = -1, maxY = -1, count = 0;
    for (let y = 0; y < masks.height; y++) for (let x = 0; x < masks.width; x++) {
        const mx = (x + .5) / masks.width, my = (y + .5) / masks.height, at = y * masks.width + x, b = person.bounds;
        if (mx < b.x || mx > b.x + b.width || my < b.y || my > b.y + b.height || masks.face[at] < .65) continue;
        count++; minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y);
    }
    if (count < Math.max(8, masks.width * masks.height * .002) || maxX - minX < 2 || maxY - minY < 2) return null;
    return { x: minX / masks.width, y: minY / masks.height, width: (maxX - minX + 1) / masks.width, height: (maxY - minY + 1) / masks.height };
}
export function smoothRegion(previous, next) {
    if (!next) return null;
    // A cut or another person must not interpolate across the picture.
    if (!previous || Math.abs(previous.x - next.x) + Math.abs(previous.y - next.y) > .3) return { ...next };
    return Object.fromEntries(['x','y','width','height'].map(k => [k, previous[k] + (next[k] - previous[k]) * .35]));
}
export function reshapeProblem(settings) {
    if (!['face','body'].includes(settings.region)) return 'Choose face or body reshaping.';
    if (![settings.widthAmount, settings.heightAmount].every(n => Number.isFinite(n) && n >= -.25 && n <= .25)) return 'Choose reshape amounts between −25% and 25%.';
    if (!settings.widthAmount && !settings.heightAmount) return 'Change the width or height before reshaping.';
    return null;
}
function bilinear(frame, x, y, output, p) {
    const fx = clamp(x * frame.width - .5, 0, frame.width - 1), fy = clamp(y * frame.height - .5, 0, frame.height - 1), ix = Math.floor(fx), iy = Math.floor(fy), nx = Math.min(ix + 1, frame.width - 1), ny = Math.min(iy + 1, frame.height - 1), dx = fx - ix, dy = fy - iy;
    const points = [[ix,iy,(1-dx)*(1-dy)],[nx,iy,dx*(1-dy)],[ix,ny,(1-dx)*dy],[nx,ny,dx*dy]];
    let alpha = 0; const rgb = [0,0,0];
    for (const [sx,sy,w] of points) { const at = (sy * frame.width + sx) * 4, a = frame.data[at + 3] / 255; alpha += a * w; for (let c=0;c<3;c++) rgb[c] += frame.data[at+c] * a * w; }
    for (let c=0;c<3;c++) output[p+c] = alpha ? rgb[c]/alpha : 0;
    output[p+3] = alpha * 255;
}
/** Smooth inverse deformation: no empty pixels, unchanged outer boundary, bounded displacement. */
export function reshapePersonPixels(frame, bounds, settings) {
    assertPicture(frame,4);
    const problem = reshapeProblem(settings); if (problem) throw new Error(problem);
    const data = new Uint8ClampedArray(frame.data); if (!bounds) return { ...frame, data };
    if (!['x','y','width','height'].every(k => Number.isFinite(bounds[k])) || bounds.width <= 0 || bounds.height <= 0 || bounds.x < 0 || bounds.y < 0 || bounds.x + bounds.width > 1.000001 || bounds.y + bounds.height > 1.000001) throw new Error('Choose valid person bounds.');
    const cx = bounds.x + bounds.width / 2, cy = bounds.y + bounds.height / 2, rx = bounds.width * .85, ry = bounds.height * .7;
    for (let y=0;y<frame.height;y++) for (let x=0;x<frame.width;x++) {
        const mx=(x+.5)/frame.width, my=(y+.5)/frame.height, dx=(mx-cx)/rx, dy=(my-cy)/ry, radius=dx*dx+dy*dy;
        if (radius >= 1) continue;
        const falloff=(1-radius)**2, sx=cx+(mx-cx)/(1+settings.widthAmount*falloff), sy=cy+(my-cy)/(1+settings.heightAmount*falloff);
        bilinear(frame,sx,sy,data,(y*frame.width+x)*4);
    }
    return { width: frame.width, height: frame.height, data };
}
