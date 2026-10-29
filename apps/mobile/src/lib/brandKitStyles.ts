import { FONTS, normaliseColour } from './brandKit';

// Copied from app/veyrnox/_lib/editorSequenceValidation.mjs:25 and editorTextStyle.mjs:3.
export const TEXT_DEFAULTS = Object.freeze({ color: '#ffffff', background: '#000000', backgroundOpacity: 0, stroke: '#000000', strokeWidth: 2, weight: 'bold', font: 'sans-serif', align: 'center' });
export const TEXT_EXTRAS = Object.freeze({italic:false,underline:false,letterSpacing:0,lineHeight:1.2,shadowColor:'#000000',shadowOpacity:0,shadowBlur:4,shadowX:2,shadowY:2});
export const STYLE_MAX = 12, STYLE_NAME_MAX = 80, SIZE_MIN = 2, SIZE_MAX = 40, DEFAULT_SIZE = 6;
export type TextStyle = { name: string; size: number; style: Record<string, unknown> };
const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const number = (v: unknown, min: number, max: number) => typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max;
const colour = (v: unknown) => typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v);
export function textStyleProblem(v: unknown): 'name' | 'size' | 'style' | null {
    if (!record(v) || Object.keys(v).length !== 3 || Object.keys(v).some(k => !['name', 'size', 'style'].includes(k))) return 'style';
    if (typeof v.name !== 'string' || !v.name.trim() || v.name.length > STYLE_NAME_MAX || /[\u0000-\u001f\u007f]/.test(v.name)) return 'name';
    if (!Number.isInteger(v.size) || !number(v.size, SIZE_MIN, SIZE_MAX)) return 'size';
    const s = v.style;
    if (!record(s) || Object.keys(TEXT_DEFAULTS).some(k => !Object.hasOwn(s, k)) || Object.keys(s).some(k => !Object.hasOwn(TEXT_DEFAULTS, k) && !Object.hasOwn(TEXT_EXTRAS, k))) return 'style';
    if (!['color', 'background', 'stroke'].every(k => colour(s[k])) || !number(s.backgroundOpacity, 0, 1) || !number(s.strokeWidth, 0, 12)) return 'style';
    if (!(FONTS as readonly unknown[]).includes(s.font) || !['normal', 'bold'].includes(s.weight as string) || !['left', 'center', 'right'].includes(s.align as string)) return 'style';
    for (const k of ['italic', 'underline']) if (Object.hasOwn(s, k) && typeof s[k] !== 'boolean') return 'style';
    if (Object.hasOwn(s, 'shadowColor') && !colour(s.shadowColor)) return 'style';
    const bounds: Record<string, [number, number]> = { letterSpacing: [-10, 30], lineHeight: [.8, 3], shadowOpacity: [0, 1], shadowBlur: [0, 30], shadowX: [-50, 50], shadowY: [-50, 50] };
    for (const [k, [min, max]] of Object.entries(bounds)) if (Object.hasOwn(s, k) && !number(s[k], min, max)) return 'style';
    return null;
}
export interface StyleForm {
    name: string; size: string; font: string; color: string; background: string; backgroundOpacity: string;
    stroke: string; strokeWidth: string; weight: string; align: string; italic: boolean; underline: boolean;
}
export const emptyStyleForm = (): StyleForm => ({ ...TEXT_DEFAULTS, name: '', size: String(DEFAULT_SIZE), backgroundOpacity: '0', strokeWidth: String(TEXT_DEFAULTS.strokeWidth), italic: false, underline: false });
export function formFromStyle(s: TextStyle): StyleForm {
    return { name: s.name, size: String(s.size), font: String(s.style.font), color: String(s.style.color), background: String(s.style.background), backgroundOpacity: String(Number((Number(s.style.backgroundOpacity) * 100).toFixed(2))), stroke: String(s.style.stroke), strokeWidth: String(s.style.strokeWidth), weight: String(s.style.weight), align: String(s.style.align), italic: s.style.italic === true, underline: s.style.underline === true };
}
type ErrorKey = `brand.style.err.${'name' | 'size' | 'colour' | 'opacity' | 'stroke'}`;
export function styleFromForm(form: StyleForm, base?: TextStyle): { style: TextStyle } | { errorKey: ErrorKey } {
    if (!form.name.trim() || form.name.length > STYLE_NAME_MAX || /[\u0000-\u001f\u007f]/.test(form.name)) return { errorKey: 'brand.style.err.name' };
    const size = Number(form.size), opacity = Number(form.backgroundOpacity), strokeWidth = Number(form.strokeWidth);
    if (!form.size.trim() || !Number.isInteger(size) || !number(size, SIZE_MIN, SIZE_MAX)) return { errorKey: 'brand.style.err.size' };
    const color = normaliseColour(form.color), background = normaliseColour(form.background), stroke = normaliseColour(form.stroke);
    if (!color || !background || !stroke) return { errorKey: 'brand.style.err.colour' };
    if (!form.backgroundOpacity.trim() || !number(opacity, 0, 100)) return { errorKey: 'brand.style.err.opacity' };
    if (!form.strokeWidth.trim() || !number(strokeWidth, 0, 12)) return { errorKey: 'brand.style.err.stroke' };
    // Preserve web precision when the displayed percentage has not been changed.
    const backgroundOpacity = base && opacity === Number(formFromStyle(base).backgroundOpacity)
        ? base.style.backgroundOpacity : Number((opacity / 100).toFixed(2));
    const style: Record<string, unknown> = { ...TEXT_DEFAULTS, ...base?.style, color, background, stroke, backgroundOpacity, strokeWidth, font: form.font, weight: form.weight, align: form.align };
    for (const key of ['italic', 'underline'] as const) if (form[key] || (base && Object.hasOwn(base.style, key))) style[key] = form[key];
    return { style: { name: form.name.trim(), size, style } };
}
