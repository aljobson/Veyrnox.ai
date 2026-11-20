const decimals = (step: number) => {
    const [base, exponent = '0'] = String(step).split('e');
    return Math.max(0, (base.split('.')[1]?.length ?? 0) - Number(exponent));
};
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
const round = (value: number, step: number) => Number((Math.round(value / step) * step).toFixed(decimals(step)));
export function sliderValue(x: number, width: number, min: number, max: number, step: number, snaps: number[] = [], snapDistance = step / 2,
    motion?: { value: number; delta: number }): number {
    // Imported values may be outside the track: an outward drag must not clamp them backwards.
    if (motion && ((motion.value > max && motion.delta >= 0) || (motion.value < min && motion.delta <= 0))) return motion.value;
    const value = clamp(round(clamp(min + (width > 0 ? x / width : 0) * (max - min), min, max), step), min, max);
    const nearest = snaps.filter(point => point >= min && point <= max && Math.abs(point - value) < snapDistance)
        .sort((a, b) => Math.abs(a - value) - Math.abs(b - value))[0];
    return nearest ?? value;
}
export const stepValue = (value: number, dir: -1 | 1, min: number, max: number, step: number): number =>
    clamp(Number((value + dir * step).toFixed(decimals(step))), Math.min(min, value), Math.max(max, value));
