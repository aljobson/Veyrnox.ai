// Mobile equivalent of preparePuppetPixels, yielding between bounded row batches.
export interface PuppetRig {
    head: number[][]; pivot: number[]; eyes: number[][]; chest: number[];
    arms: number[][]; lower: number[]; shutter?: boolean; tilt: number;
}
export interface Pixels { width: number; height: number; data: Uint8Array }
export const yieldPuppetTask = () => new Promise<void>(resolve => setTimeout(resolve, 0));
export function checkPuppetAbort(signal?: AbortSignal) {
    if (signal?.aborted) throw new Error('puppet_aborted');
}
interface Options {
    signal?: AbortSignal;
    yieldTask?: () => Promise<void>;
    onBatch?: (milliseconds: number) => void;
}
export async function preparePuppetPixelsBatched(source: Pixels, polygon: Uint8Array, rig: PuppetRig, options: Options = {}) {
    const { signal, yieldTask = yieldPuppetTask, onBatch } = options;
    checkPuppetAbort(signal);
    const { width, height, data } = source;
    // Cache the numeric primitives used by the inner loop (also avoids Jest VM global lookups).
    const { max, min, floor, ceil, round, hypot } = Math;
    const plate = new Uint8Array(data.length), head = new Uint8Array(data.length);
    plate.set(data);
    const at = (x: number, y: number, channel: number) => data[(max(0, min(height - 1, round(y))) * width
        + max(0, min(width - 1, round(x)))) * 4 + channel];
    const lids = rig.eyes.map(([x, y, , ry]) => rig.shutter ? [0.055, 0.05, 0.045]
        : [0, 1, 2].map(channel => at(x, y + ry * 2.3, channel) / 255));
    const xs = rig.head.map(([x]) => x), ys = rig.head.map(([, y]) => y);
    const minX = max(0, floor(min(...xs)) - 10);
    const maxX = min(width - 1, ceil(max(...xs)) + 10);
    const minY = max(0, floor(min(...ys)) - 10);
    const maxY = min(height - 1, ceil(max(...ys)) + 10);
    const lefts = new Int32Array(height).fill(-1), rights = new Int32Array(height);
    // Only scan the head's bounding rows. Yield on elapsed work, not a fixed row count.
    for (let y = minY; y <= maxY;) {
        checkPuppetAbort(signal);
        const began = performance.now();
        do {
            let left = minX, right = maxX;
            while (left <= right && !polygon[(y * width + left) * 4 + 3]) left++;
            while (right >= left && !polygon[(y * width + right) * 4 + 3]) right--;
            if (left <= right) { lefts[y] = left; rights[y] = right; }
            y++;
        } while (y <= maxY && performance.now() - began < 8);
        onBatch?.(performance.now() - began);
        if (y <= maxY) { await yieldTask(); checkPuppetAbort(signal); }
    }
    const lastBackgroundRow = max(minY, min(maxY, floor((rig.pivot?.[1] ?? maxY + 75) - 75)));
    const samples = new Array<number>(9), left = new Array<number>(3), right = new Array<number>(3);
    const bg = new Array<number>(3);
    const median = (x: number, row: number, channel: number) => {
        for (let i = 0; i < 9; i++) samples[i] = at(x + i - 4, row, channel);
        samples.sort((a, b) => a - b);
        return samples[4];
    };
    // Amortize timer latency while keeping each processing batch near eight milliseconds.
    for (let y = minY; y <= maxY;) {
        checkPuppetAbort(signal);
        const began = performance.now();
        do {
            const row = min(y, lastBackgroundRow);
            const leftX = max(0, (lefts[row] >= 0 ? lefts[row] : width * 0.1) - 22);
            const rightX = min(width - 1, (lefts[row] >= 0 ? rights[row] : width * 0.9) + 22);
            for (let c = 0; c < 3; c++) { left[c] = median(leftX, row, c); right[c] = median(rightX, row, c); }
            for (let x = minX; x <= maxX; x++) {
                const index = (y * width + x) * 4, shape = polygon[index + 3] / 255;
                if (!shape) continue;
                const mix = max(0, min(1, (x - leftX) / max(1, rightX - leftX)));
                for (let c = 0; c < 3; c++) bg[c] = left[c] + (right[c] - left[c]) * mix;
                const distance = hypot((data[index] - bg[0]) / 255, (data[index + 1] - bg[1]) / 255, (data[index + 2] - bg[2]) / 255);
                const t = max(0, min(1, (distance - 0.045) / (0.11 - 0.045)));
                const alpha = shape * (t * t * (3 - 2 * t));
                if (alpha < 1 / 255) continue;
                for (let c = 0; c < 3; c++) {
                    plate[index + c] = round(bg[c]);
                    const foreground = max(0, min(255, (data[index + c] - bg[c] * (1 - alpha)) / alpha));
                    head[index + c] = round(foreground * alpha);
                }
                head[index + 3] = round(alpha * 255);
            }
            y++;
        } while (y <= maxY && performance.now() - began < 8);
        onBatch?.(performance.now() - began);
        if (y <= maxY) { await yieldTask(); checkPuppetAbort(signal); }
    }
    checkPuppetAbort(signal);
    return { plate, head, lids };
}
