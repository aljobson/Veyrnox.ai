export interface ShapeItem { readonly held?: boolean; readonly shape_ambiguous?: boolean; readonly video_width?: number | null; readonly video_height?: number | null; readonly width?: number | null; readonly height?: number | null; readonly aspect?: number | string | null; readonly ratio?: number | string | null; }
// File dimensions are authoritative. Keep the server's rounded ratio and 3% rule.
export const SAME_SHAPE_TOLERANCE = 0.03;
export function sameShape(a: unknown, b: unknown) {
    const x = Number(a), y = Number(b);
    if (!(x > 0 && y > 0)) return String(a) === String(b);
    return Math.abs(x - y) / Math.max(x, y) <= SAME_SHAPE_TOLERANCE;
}
export const validDimension = (n: unknown): n is number => typeof n === 'number' && Number.isInteger(n) && n >= 1 && n <= 16384;
export function shapeValue(w: unknown, h: unknown) {
    return validDimension(w) && validDimension(h) ? (w / h).toFixed(2) : null;
}
export function itemShape(item: ShapeItem | null | undefined) {
    if (!item || item.held || item.shape_ambiguous) return null;
    const measured = shapeValue(item.video_width ?? item.width, item.video_height ?? item.height);
    if (measured !== null) return measured;
    const value = item.aspect ?? item.ratio;
    return Number.isFinite(Number(value)) && Number(value) > 0 ? Number(value).toFixed(2) : null;
}
export function shapeOrientation(w: ShapeItem | number, h?: number) {
    const value = typeof w === 'object' ? itemShape(w) : shapeValue(w, h);
    return !value ? null : sameShape(value, 1) ? 'square' : Number(value) < 1 ? 'portrait' : 'landscape';
}
const RATIOS = ['1:1', '9:16', '16:9', '4:5', '5:4', '3:4', '4:3', '2:3', '3:2', '9:21', '21:9'];
export function requestedShape(value: unknown) {
    if (typeof value !== 'string' || !/^\d+(?:\.\d+)?:\d+(?:\.\d+)?$/.test(value)) return null;
    const [w, h] = value.split(':').map(Number);
    return (w ?? 0) > 0 && (h ?? 0) > 0 ? (w! / h!).toFixed(2) : null;
}
export function shapeLabelParts(item: ShapeItem) {
    const value = itemShape(item);
    if (!value) return null;
    const ratio = RATIOS.filter(r => sameShape(value, requestedShape(r))).sort((a, b) =>
        Math.abs(Number(value) - Number(requestedShape(a))) - Math.abs(Number(value) - Number(requestedShape(b))))[0] ?? null;
    return { orientation: shapeOrientation(item), ratio };
}
export function shapeMismatch(item: ShapeItem | undefined, anchor: ShapeItem | undefined) {
    const a = itemShape(anchor), b = itemShape(item);
    return !!a && !!b && !sameShape(a, b);
}
export function mixedShapes(items: readonly ShapeItem[]) {
    return items.some(item => shapeMismatch(item, items[0]));
}
export function requestedMismatch(item: ShapeItem, requested: unknown) {
    const actual = itemShape(item), wanted = requestedShape(requested);
    return !!actual && !!wanted && !sameShape(actual, wanted);
}
export function matchingOption(item: ShapeItem, options: readonly string[]) {
    const actual = itemShape(item);
    return actual ? options.find(option => requestedShape(option) && sameShape(actual, requestedShape(option))) ?? null : null;
}
