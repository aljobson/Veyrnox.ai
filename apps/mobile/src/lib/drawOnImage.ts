import { kindOf, textInput, type CatalogModel } from './media';
import { slotsFor } from './sources';

export const POINT_LIMIT = 20_000;
export const DRAW_COLORS = { yellow: '#eab308', red: '#ef4444', white: '#ffffff', cyan: '#22d3ee' } as const;
export type Point = { readonly x: number; readonly y: number };
export type Size = { readonly width: number; readonly height: number };
export type Fit = Size & Point & { readonly scale: number };
export type Stroke = { readonly kind: 'pen' | 'erase'; readonly points: readonly Point[]; readonly color: string; readonly width: number };
export type Box = { readonly kind: 'box'; readonly x: number; readonly y: number; readonly width: number; readonly height: number; readonly color: string; readonly strokeWidth: number };
export type DrawOp = Stroke | Box;
export type BoxAction = 'increment' | 'decrement' | 'moveLeft' | 'moveRight' | 'moveUp' | 'moveDown';
export type DrawAction =
    | { type: 'addStroke'; stroke: Stroke }
    | { type: 'extendStroke'; point: Point }
    | { type: 'addBox'; box: Box }
    | { type: 'adjustBox'; index: number; action: BoxAction; image: Size }
    | { type: 'undo' | 'clear' };

export function canDraw(model: CatalogModel): boolean {
    return kindOf(model.modality) === 'image' && slotsFor(model).some(s => s.slot === 'image' && s.kind === 'image') && textInput(model)?.key === 'prompt';
}
export function fitRect(view: Size, image: Size): Fit {
    const scale = Math.min(view.width / image.width, view.height / image.height);
    const width = image.width * scale, height = image.height * scale;
    return { x: (view.width - width) / 2, y: (view.height - height) / 2, width, height, scale };
}
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
export function toImagePoint(touch: Point, fit: Fit): Point {
    return { x: clamp((touch.x - fit.x) / fit.scale, 0, fit.width / fit.scale), y: clamp((touch.y - fit.y) / fit.scale, 0, fit.height / fit.scale) };
}
export const strokeWidthPx = (displayPoints: number, scale: number): number => displayPoints / scale;
// The native resizer applies the long-edge cap before this additional catalog constraint.
export function exportSize(width: number, height: number, maxPixels?: number): Size {
    const ratio = maxPixels && maxPixels > 0 ? Math.min(1, Math.sqrt(maxPixels / (width * height))) : 1;
    return { width: Math.max(1, Math.floor(width * ratio)), height: Math.max(1, Math.floor(height * ratio)) };
}
export const pointCount = (ops: readonly DrawOp[]): number => ops.reduce((n, op) => n + (op.kind === 'box' ? 2 : op.points.length), 0);
export function adjustBox(box: Box, action: BoxAction, image: Size): Box {
    const delta = action === 'increment' ? 0.1 : action === 'decrement' ? -0.1 : 0;
    const width = clamp(box.width + delta * image.width, Math.min(1, image.width), image.width);
    const height = clamp(box.height + delta * image.height, Math.min(1, image.height), image.height);
    const x = box.x + (box.width - width) / 2 + (action === 'moveLeft' ? -0.05 : action === 'moveRight' ? 0.05 : 0) * image.width;
    const y = box.y + (box.height - height) / 2 + (action === 'moveUp' ? -0.05 : action === 'moveDown' ? 0.05 : 0) * image.height;
    return { ...box, x: clamp(x, 0, image.width - width), y: clamp(y, 0, image.height - height), width, height };
}
export function drawReducer(ops: readonly DrawOp[], action: DrawAction): readonly DrawOp[] {
    switch (action.type) {
        case 'undo': return ops.slice(0, -1);
        case 'clear': return [];
        case 'addBox': return pointCount(ops) + 2 > POINT_LIMIT ? ops : [...ops, { ...action.box }];
        case 'addStroke': {
            const points: Point[] = [];
            const room = POINT_LIMIT - pointCount(ops);
            for (const point of action.stroke.points) {
                const last = points[points.length - 1];
                if (points.length >= room) break;
                if (!last || Math.hypot(point.x - last.x, point.y - last.y) >= 1) points.push({ ...point });
            }
            return points.length ? [...ops, { ...action.stroke, points }] : ops;
        }
        case 'extendStroke': {
            const last = ops[ops.length - 1];
            if (!last || last.kind === 'box' || pointCount(ops) >= POINT_LIMIT) return ops;
            const previous = last.points[last.points.length - 1];
            if (Math.hypot(previous.x - action.point.x, previous.y - action.point.y) < 1) return ops;
            return [...ops.slice(0, -1), { ...last, points: [...last.points, { ...action.point }] }];
        }
        case 'adjustBox': return ops.map((op, i) => i === action.index && op.kind === 'box' ? adjustBox(op, action.action, action.image) : op);
    }
}
