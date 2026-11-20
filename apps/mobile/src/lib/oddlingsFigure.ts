// Import geometry as code: Hermes never evaluates generated JavaScript strings.
import { mannequinShapes, mannequinViewBox } from '../../../../app/veyrnox/_lib/oddlingMannequin.js';
import { sanitizePicks, type Picks } from './oddlingsBuilder';

export const FIGURE_BACKGROUND = '#141416';
const TAGS = new Set(['circle', 'ellipse', 'path', 'rect', 'line', 'polygon', 'polyline']);
const escape = (value: unknown) => String(value).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const kebab = (key: string) => key.replace(/[A-Z]/g, c => '-' + c.toLowerCase());

export function svgForPicks(picks: Picks, focus = 'body'): string {
    const p = sanitizePicks(picks);
    const body = mannequinShapes(p).map((shape: { tag: string; attrs: Record<string, unknown>; fill?: string; stroke?: string; opacity?: number }) => {
        if (!TAGS.has(shape.tag)) return '';
        const attrs = { ...shape.attrs };
        if (shape.fill !== undefined) attrs.fill = shape.fill;
        if (shape.stroke) attrs.stroke = shape.stroke;
        if (shape.opacity) attrs.opacity = shape.opacity;
        return '<' + shape.tag + Object.keys(attrs).filter(k => /^[a-zA-Z]+$/.test(k))
            .map(k => ' ' + kebab(k) + '="' + escape(attrs[k]) + '"').join('') + '/>';
    }).join('');
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="' + escape(mannequinViewBox(focus || 'body', p)) + '" preserveAspectRatio="xMidYMid meet">' + body + '</svg>';
}
