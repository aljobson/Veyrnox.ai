// Limbs, neck styling and proportions for the Oddling preview figure. Pure geometry in the figure's own pixel space (120 x 230), one table row
// per option, so a test can pin that every option of every group exists and draws differently from its siblings.
import { darken, lighten } from './oddlingColour.js';

const num = (value) => Math.round(value * 10) / 10;
const stroke = (key, d, colour, width, extra = {}) => ({ key, tag: 'path', attrs: { d, strokeWidth: num(width), strokeLinecap: 'round', strokeLinejoin: 'round', ...(extra.dash ? { strokeDasharray: extra.dash } : {}) }, fill: 'none', stroke: colour, ...(extra.opacity ? { opacity: extra.opacity } : {}) });
const disc = (key, cx, cy, r, fill, extra = {}) => ({ key, tag: 'circle', attrs: { cx: num(cx), cy: num(cy), r: num(r) }, fill, ...extra });
const box = (key, x, y, w, h, fill, rx = 1.5, extra = {}) => ({ key, tag: 'rect', attrs: { x: num(x), y: num(y), width: num(w), height: num(h), rx }, fill, ...extra });
const gear = (key, cx, cy, r, fill) => ({ key, tag: 'path', attrs: { d: Array.from({ length: 16 }, (_, i) => { const a = (i / 16) * Math.PI * 2, rr = i % 2 ? r * 0.78 : r; return `${i ? 'L' : 'M'}${num(cx + Math.cos(a) * rr)} ${num(cy + Math.sin(a) * rr)}`; }).join('') + 'Z' }, fill, stroke: darken(fill, 0.45), strokeWidth: 0.6 });
const heart = (key, cx, cy, s, fill) => ({ key, tag: 'path', attrs: { d: `M${num(cx)} ${num(cy + s)}C${num(cx - s * 2)} ${num(cy - s * 0.4)} ${num(cx - s * 0.5)} ${num(cy - s * 1.3)} ${num(cx)} ${num(cy - s * 0.3)}C${num(cx + s * 0.5)} ${num(cy - s * 1.3)} ${num(cx + s * 2)} ${num(cy - s * 0.4)} ${num(cx)} ${num(cy + s)}Z` }, fill });

const PINK = '#f4a7c3', STEEL = '#9aa3ae', BRASS = '#b98a3c', SOCKET = '#c9a27a', ROD = '#4a4a52', GLOW = '#58e1ff';

/**
 * Arm in the figure's space. g: { side, x0, y0, x1, y1, w, handR, skin, sleeve }. (x0,y0) is the shoulder end, (x1,y1) the wrist.
 * Every kind returns its own shapes; keys are unique per side.
 */
const ARMS = {
  Normal: (g) => [stroke(`arm-${g.side}`, `M${g.x0} ${g.y0}L${g.x1} ${g.y1}`, g.skin, g.w), disc(`hand-${g.side}`, g.x1, g.y1 + g.handR * 0.4, g.handR, g.skin)],
  None: (g) => [stroke(`arm-${g.side}`, `M${g.x0} ${g.y0}L${num(g.x0 + (g.x1 - g.x0) * 0.22)} ${num(g.y0 + (g.y1 - g.y0) * 0.22)}`, g.skin, g.w)],
  'Cute Prosthetic': (g) => [stroke(`arm-${g.side}`, `M${g.x0} ${g.y0}L${g.x1} ${g.y1}`, PINK, g.w + 0.6), disc(`elbow-${g.side}`, (g.x0 + g.x1) / 2, (g.y0 + g.y1) / 2, g.w * 0.6, lighten(PINK, 0.4)), heart(`heart-${g.side}`, (g.x0 + g.x1) / 2 + (g.x1 - g.x0) * 0.2, (g.y0 + g.y1) / 2 + (g.y1 - g.y0) * 0.2, 1.6, '#e0457b'), disc(`hand-${g.side}`, g.x1, g.y1 + g.handR * 0.4, g.handR, PINK)],
  Robotic: (g) => { const mx = (g.x0 + g.x1) / 2, my = (g.y0 + g.y1) / 2; return [stroke(`arm-${g.side}`, `M${g.x0} ${g.y0}L${g.x1} ${g.y1}`, STEEL, g.w + 0.8), stroke(`ring-a-${g.side}`, `M${num(mx - g.w)} ${num(my - 6)}h${num(g.w * 2)}`, darken(STEEL, 0.4), 1.2), stroke(`ring-b-${g.side}`, `M${num(mx - g.w)} ${num(my + 8)}h${num(g.w * 2)}`, darken(STEEL, 0.4), 1.2), disc(`joint-${g.side}`, mx, my, 2.4, GLOW), box(`hand-${g.side}`, g.x1 - g.handR, g.y1 - 1, g.handR * 2, g.handR * 1.8, STEEL, 1.5)]; },
  Prosthetic: (g) => [stroke(`arm-${g.side}`, `M${g.x0} ${g.y0}L${num(g.x0 + (g.x1 - g.x0) * 0.4)} ${num(g.y0 + (g.y1 - g.y0) * 0.4)}`, SOCKET, g.w + 1), stroke(`rod-${g.side}`, `M${num(g.x0 + (g.x1 - g.x0) * 0.4)} ${num(g.y0 + (g.y1 - g.y0) * 0.4)}L${g.x1} ${g.y1}`, ROD, 2.2), stroke(`hook-${g.side}`, `M${g.x1} ${g.y1}q${g.side === 'l' ? -4 : 4} 3 ${g.side === 'l' ? -2 : 2} 7`, ROD, 2)],
  Mechanical: (g) => { const mx = (g.x0 + g.x1) / 2, my = (g.y0 + g.y1) / 2; return [stroke(`arm-${g.side}`, `M${g.x0} ${g.y0}L${g.x1} ${g.y1}`, BRASS, g.w + 0.6), gear(`gear-a-${g.side}`, mx, my, 4.6, lighten(BRASS, 0.15)), gear(`gear-b-${g.side}`, g.x1, g.y1 + g.handR * 0.3, g.handR * 1.25, BRASS)]; },
};

/** Leg. g: { side, x, hipY, len, w, footLen, footX, skin, bottom, down }. */
const LEGS = {
  Normal: (g) => [box(`leg-${g.side}`, g.x - g.w / 2, g.hipY - 2, g.w, g.len, g.skin, g.w / 2), ...(g.down ? [box(`bottom-${g.side}`, g.x - g.w / 2 - 0.8, g.hipY - 2, g.w + 1.6, g.len * g.down, g.bottom, 2)] : []), { key: `shoe-${g.side}`, tag: 'ellipse', attrs: { cx: g.footX, cy: g.hipY + g.len, rx: g.footLen / 2 + g.w / 3, ry: 3.6 }, fill: '#26262b' }],
  None: (g) => [box(`leg-${g.side}`, g.x - g.w / 2, g.hipY - 2, g.w, g.len * 0.42, g.skin, g.w / 2), ...(g.down ? [box(`bottom-${g.side}`, g.x - g.w / 2 - 0.8, g.hipY - 2, g.w + 1.6, g.len * 0.4, g.bottom, 2)] : [])],
  'Cute Prosthetic': (g) => [box(`leg-${g.side}`, g.x - g.w / 2, g.hipY - 2, g.w, g.len, PINK, g.w / 2), disc(`knee-${g.side}`, g.x, g.hipY + g.len * 0.45, g.w * 0.55, lighten(PINK, 0.4)), heart(`heart-${g.side}`, g.x, g.hipY + g.len * 0.72, 1.7, '#e0457b'), { key: `shoe-${g.side}`, tag: 'ellipse', attrs: { cx: g.footX, cy: g.hipY + g.len, rx: g.footLen / 2 + g.w / 3, ry: 3.6 }, fill: '#e0457b' }],
  Robotic: (g) => [box(`leg-${g.side}`, g.x - g.w / 2, g.hipY - 2, g.w, g.len, STEEL, 2), stroke(`ring-${g.side}`, `M${num(g.x - g.w / 2)} ${num(g.hipY + g.len * 0.6)}h${num(g.w)}`, darken(STEEL, 0.4), 1.2), disc(`knee-${g.side}`, g.x, g.hipY + g.len * 0.42, 2.4, GLOW), box(`shoe-${g.side}`, g.footX - g.footLen / 2 - 2, g.hipY + g.len - 4, g.footLen + 4, 6, darken(STEEL, 0.3), 2)],
  Prosthetic: (g) => [box(`leg-${g.side}`, g.x - g.w / 2, g.hipY - 2, g.w, g.len * 0.4, SOCKET, g.w / 2), stroke(`rod-${g.side}`, `M${g.x} ${num(g.hipY + g.len * 0.4)}L${g.x} ${num(g.hipY + g.len - 2)}`, ROD, 2.4), stroke(`blade-${g.side}`, `M${g.x} ${num(g.hipY + g.len - 2)}q${g.side === 'l' ? -7 : 7} 0 ${g.side === 'l' ? -9 : 9} 5`, ROD, 2.6)],
  Mechanical: (g) => [box(`leg-${g.side}`, g.x - g.w / 2, g.hipY - 2, g.w, g.len, BRASS, 2), gear(`gear-a-${g.side}`, g.x, g.hipY + g.len * 0.42, 5, lighten(BRASS, 0.15)), gear(`gear-b-${g.side}`, g.x, g.hipY + g.len * 0.82, 3.6, BRASS), box(`shoe-${g.side}`, g.footX - g.footLen / 2 - 2, g.hipY + g.len - 4, g.footLen + 4, 6, darken(BRASS, 0.35), 2)],
};

// strokeWidth belongs in attrs for the renderer; some shapes above carry it at the top level for brevity.
const norm = (shape) => { if (shape.strokeWidth === undefined) return shape; const { strokeWidth, ...rest } = shape; return { ...rest, attrs: { ...rest.attrs, strokeWidth } }; };

export const limbShapes = (group, picks, g) => {
  const table = group.includes('arm') ? ARMS : LEGS;
  return (table[picks?.[group]] || table.Normal)(g).map(norm);
};

/** Neck styling. g: { chinY, shoulderY, neckPx, top (outfit colour) }. Drawn over the neck, under the head. */
const NECKWEAR = {
  Bare: () => [],
  'Tower Collar': (g) => [box('neckwear', 60 - 8, g.chinY - 3, 16, g.neckPx + 9, darken(g.top, 0.2), 3), stroke('neckwear-rim', `M${60 - 8} ${num(g.chinY - 3)}h16`, lighten(g.top, 0.35), 1.4)],
  Ruff: (g) => Array.from({ length: 7 }, (_, i) => disc(`neckwear-${i}`, 60 - 15 + i * 5, g.shoulderY - 1, 4.2, '#f2ecdd', { stroke: '#c9bfa8', strokeWidth: 0.6 })),
  'Stacked Rings': (g) => Array.from({ length: Math.max(3, Math.round(g.neckPx / 2.4) + 1) }, (_, i) => ({ key: `neckwear-${i}`, tag: 'ellipse', attrs: { cx: 60, cy: g.shoulderY - 2 - i * 2.6, rx: 7.2, ry: 1.7 }, fill: '#e0b93c', stroke: '#9c7a1c', strokeWidth: 0.5 })),
  'Bow Sculpture': (g) => [{ key: 'neckwear-l', tag: 'path', attrs: { d: `M60 ${num(g.shoulderY)}L48 ${num(g.shoulderY - 6)}L48 ${num(g.shoulderY + 6)}Z` }, fill: '#e0457b' }, { key: 'neckwear-r', tag: 'path', attrs: { d: `M60 ${num(g.shoulderY)}L72 ${num(g.shoulderY - 6)}L72 ${num(g.shoulderY + 6)}Z` }, fill: '#e0457b' }, disc('neckwear-knot', 60, g.shoulderY, 3, '#b3295a')],
  'Feather Halo': (g) => Array.from({ length: 9 }, (_, i) => { const a = Math.PI + (i / 8) * Math.PI, cx = 60 + Math.cos(a) * 17, cy = g.shoulderY + 1 + Math.sin(a) * 6; return { key: `neckwear-${i}`, tag: 'ellipse', attrs: { cx: num(cx), cy: num(cy), rx: 2.6, ry: 7, transform: `rotate(${num((a - Math.PI * 1.5) * 57.3)} ${num(cx)} ${num(cy)})` }, fill: i % 2 ? '#dbe7f6' : '#f6f0e4', stroke: '#a9b8cc', strokeWidth: 0.4 }; }),
};
export const neckShapes = (picks, g) => (NECKWEAR[picks?.neck] || NECKWEAR.Bare)(g).map(norm);

/** Proportion modifiers: multipliers on torso, hands and neck, and extra half-width at the shoulders. */
export const PROPORTIONS = Object.freeze({
  Natural: {}, 'Tiny Torso': { torso: 0.7, limb: 1.25 }, 'Long Torso': { torso: 1.28, limb: 0.85 }, 'Huge Hands': { hand: 2.1 }, 'Tiny Hands': { hand: 0.5 },
  'Wide Shoulders': { shoulder: 7 }, 'Narrow Shoulders': { shoulder: -5 }, 'Long Neck': { neck: 2.5 }, 'No Visible Neck': { neck: 0.12 },
});

export const BODY_TABLES = Object.freeze({ arm: Object.keys(ARMS), leg: Object.keys(LEGS), neck: Object.keys(NECKWEAR), proportions: Object.keys(PROPORTIONS) });
