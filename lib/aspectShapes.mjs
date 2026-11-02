// Aspect ratios written the way templates and models write them: "600 / 1066", "9:16". No imports, so a client component can use it.
const STANDARD = ['1:1', '9:16', '16:9'];

/** Width over height, or null when the text is not a readable "w / h" or "w:h". */
export function ratioOf(text) {
    const m = /^\s*(\d+(?:\.\d+)?)\s*[/:]\s*(\d+(?:\.\d+)?)\s*$/.exec(typeof text === 'string' ? text : '');
    if (!m) return null;
    const w = Number(m[1]);
    const h = Number(m[2]);
    return w > 0 && h > 0 ? w / h : null;
}

/** The entry of `options` whose ratio is closest to `wanted`'s, or null when `wanted` or every option is unreadable. */
export function nearestOption(wanted, options) {
    const target = ratioOf(wanted);
    if (target === null || !Array.isArray(options)) return null;
    let best = null;
    let bestGap = Infinity;
    for (const option of options) {
        const r = ratioOf(option);
        if (r === null) continue;
        const gap = Math.abs(Math.log(r / target));
        if (gap < bestGap) {
            best = option;
            bestGap = gap;
        }
    }
    return best;
}

/** The nearest of 1:1, 9:16 and 16:9 to a preview shape, or null when it is not readable. */
export const nearestShape = (previewAspect) => nearestOption(previewAspect, STANDARD);
