// File dimensions are authoritative. Keep the server's rounded ratio and 3% rule.
export const SAME_SHAPE_TOLERANCE = 0.03;
export function sameShape(a, b) {
    const x = Number(a), y = Number(b);
    if (!(x > 0 && y > 0)) return String(a) === String(b);
    return Math.abs(x - y) / Math.max(x, y) <= SAME_SHAPE_TOLERANCE;
}
export const validDimension = n => Number.isInteger(n) && n >= 1 && n <= 16384;
export function shapeValue(w, h) {
    return validDimension(w) && validDimension(h) ? (w / h).toFixed(2) : null;
}
export function itemShape(item) {
    if (!item || item.held || item.shape_ambiguous) return null;
    const measured = shapeValue(item.video_width ?? item.width, item.video_height ?? item.height);
    if (measured !== null) return measured;
    const value = item.aspect ?? item.ratio;
    return Number.isFinite(Number(value)) && Number(value) > 0 ? Number(value).toFixed(2) : null;
}
export function shapeOrientation(w, h) {
    const value = h === undefined ? itemShape(w) : shapeValue(w, h);
    return !value ? null : sameShape(value, 1) ? 'square' : Number(value) < 1 ? 'portrait' : 'landscape';
}
const RATIOS = ['1:1', '9:16', '16:9', '4:5', '5:4', '3:4', '4:3', '2:3', '3:2', '9:21', '21:9'];
export function requestedShape(value) {
    if (typeof value !== 'string' || !/^\d+(?:\.\d+)?:\d+(?:\.\d+)?$/.test(value)) return null;
    const [w, h] = value.split(':').map(Number);
    return w > 0 && h > 0 ? (w / h).toFixed(2) : null;
}
export function shapeLabelParts(item) {
    const value = itemShape(item);
    if (!value) return null;
    const ratio = RATIOS.filter(r => sameShape(value, requestedShape(r))).sort((a, b) =>
        Math.abs(Number(value) - Number(requestedShape(a))) - Math.abs(Number(value) - Number(requestedShape(b))))[0] ?? null;
    return { orientation: shapeOrientation(item), ratio };
}
export function shapeMismatch(item, anchor) {
    const a = itemShape(anchor), b = itemShape(item);
    return !!a && !!b && !sameShape(a, b);
}
export function mixedShapes(items) {
    return items.some(item => shapeMismatch(item, items[0]));
}
export function requestedMismatch(item, requested) {
    const actual = itemShape(item), wanted = requestedShape(requested);
    return !!actual && !!wanted && !sameShape(actual, wanted);
}
export function matchingOption(item, options) {
    const actual = itemShape(item);
    return actual ? options.find(option => requestedShape(option) && sameShape(actual, requestedShape(option))) ?? null : null;
}
