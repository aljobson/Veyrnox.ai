export const TEXT_GUIDES = Object.freeze([0.1, 0.5, 0.9]);
export const TEXT_GUIDE_SNAP = 0.025;
const clamp = value => Math.max(0, Math.min(1, value));
const snapped = (value, threshold) => {
    const bounded = clamp(value), guide = TEXT_GUIDES.reduce((best, candidate) => Math.abs(candidate - bounded) < Math.abs(best - bounded) ? candidate : best);
    return Math.abs(guide - bounded) <= threshold ? { value: guide, guide } : { value: bounded, guide: null };
};
/** Snap a normalized title anchor to safe-edge or centre guides without changing either axis outside the threshold. */
export function snapTextPosition(x, y, threshold = TEXT_GUIDE_SNAP) {
    const horizontal = snapped(x, threshold), vertical = snapped(y, threshold);
    return { x: horizontal.value, y: vertical.value, guideX: horizontal.guide, guideY: vertical.guide };
}
