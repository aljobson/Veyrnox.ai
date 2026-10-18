// Preview figure for the Oddling catalog. Pure geometry: picks in, a list of SVG shape descriptors out, so it can be tested without a browser.
// It is a stylised mannequin, not the final image: the real picture is AI-made from the same picks. Unpicked parts show neutral defaults.
import { SWATCHES } from './oddlingCatalog.js';
import { faceShapes } from './oddlingFace.js';

export const MANNEQUIN_BOX = Object.freeze({ width: 120, height: 230 });
const CX = 60, FEET_Y = 224, BUDGET = 205; // the whole figure, feet to top of hair, never taller than this
const DEFAULTS = Object.freeze({ body_type: 'Lean', hair: 'Short Hair', wardrobe_style: 'Modern Basics', skin_tone: 'Light', hair_color: 'Brown', eye_color: 'Brown' });

// Torso half-widths at the shoulders, waist and hips, and length multipliers.
export const BUILDS = Object.freeze({
  Slim: { s: 15, w: 11, h: 13 }, Lean: { s: 16, w: 12, h: 13 }, 'Very Skinny': { s: 12, w: 9, h: 10 }, Lanky: { s: 13, w: 10, h: 11, torso: 1.1, leg: 1.1 },
  Compact: { s: 18, w: 15, h: 16, torso: 0.92, leg: 0.92 }, Athletic: { s: 21, w: 14, h: 15 }, Muscular: { s: 24, w: 16, h: 15 }, 'Hyper-Muscular': { s: 28, w: 18, h: 16 },
  Curvy: { s: 19, w: 12, h: 22 }, Pear: { s: 17, w: 13, h: 23 }, 'Inverted Triangle': { s: 25, w: 13, h: 13 }, Barrel: { s: 22, w: 21, h: 19 },
  'Long Torso': { s: 18, w: 14, h: 15, torso: 1.2 }, 'Long Legs': { s: 18, w: 14, h: 15, leg: 1.25 }, Heavy: { s: 24, w: 22, h: 23 }, Fat: { s: 28, w: 27, h: 28 }, Skinny: { s: 13, w: 10, h: 11 },
});
const HEIGHT = { 'Very Short': 0.86, Short: 0.93, Average: 1, Tall: 1.07, 'Very Tall': 1.14 };
const SIZE = { Small: 0.8, Medium: 1, Large: 1.2, 'Extra Large': 1.4 };
const LIMB = { Small: 0.85, Medium: 1, Large: 1.12, 'Extra Large': 1.25 };
const NECK = { Small: 3, Medium: 6, Large: 10, 'Extra Large': 15 };

// Outfits: top colour, bottom colour, the bottom's cut, an optional detail, and whether the shoulders are padded.
export const OUTFITS = Object.freeze({
  'Office Surrealist': { top: '#8a93a6', bottom: '#4a5163', cut: 'trousers', detail: 'collar' }, 'Quilted Royalty': { top: '#7b4bb3', bottom: '#d8b13a', cut: 'skirt', detail: 'stripe', pad: 3 },
  'Utility Pop': { top: '#ff8a3d', bottom: '#2e6f6a', cut: 'trousers' }, 'Domestic Futurist': { top: '#e8e2d0', bottom: '#7fb7c9', cut: 'trousers' },
  'Ceremonial Sportswear': { top: '#d33f49', bottom: '#f2f2f2', cut: 'trousers', detail: 'stripe' }, 'Tiny Formalwear': { top: '#25262b', bottom: '#25262b', cut: 'trousers', detail: 'collar' },
  'Soft Sculpture': { top: '#f0a8c8', bottom: '#f0a8c8', cut: 'trousers', pad: 5 }, 'Weather Couture': { top: '#3b78c4', bottom: '#2a3d5c', cut: 'trousers', pad: 2 },
  'Modern Basics': { top: '#e6e6e6', bottom: '#3c5a8c', cut: 'trousers' }, Streetwear: { top: '#4a4a52', bottom: '#202024', cut: 'trousers', detail: 'stripe' },
  Y2K: { top: '#f06fb0', bottom: '#6ab7f0', cut: 'skirt' }, Goth: { top: '#18181b', bottom: '#18181b', cut: 'skirt' }, Retro: { top: '#e0a030', bottom: '#7a4a2a', cut: 'trousers' },
  Sporty: { top: '#2aa86a', bottom: '#1d1d20', cut: 'shorts', detail: 'stripe' }, 'Business Suit': { top: '#2b3342', bottom: '#2b3342', cut: 'trousers', detail: 'collar' },
});

// Every hair option maps to one of these drawn shapes (pinned by a test), so no option is silently drawn wrong.
export const HAIR_SHAPES = Object.freeze({
  Bald: 'none', 'Short Hair': 'short', 'Sharp Bob': 'bob', 'Sculpted Waves': 'wave', 'Sculptural Wave Tower': 'tower', 'Monumental Hair': 'tower', 'Cube Cut': 'box',
  'Sphere Cut': 'round', 'Wedge Cut': 'wedge', Tabletop: 'flat', 'Spiral Tower': 'tower', 'Crescent Cut': 'wave', 'Twin Discs': 'buns', 'Zigzag Cut': 'spike',
  'Anvil Cut': 'flat', 'Donut Halo': 'halo', 'Tube Tower': 'tower', 'Shelf Cut': 'flat', 'Long Hair': 'long', Afro: 'round', Punk: 'spike', 'Buzz Cut': 'buzz',
  'Bowl Cut': 'bob', Mullet: 'long', Braids: 'braids', Pigtails: 'pigtails', Perm: 'round', Beehive: 'tower', 'Pixie Cut': 'short', Ponytail: 'pony',
  'Top Knot': 'knot', Undercut: 'buzz', Pompadour: 'wave', Cornrows: 'buzz', Locs: 'long', 'Fur / Mane': 'wild', Tentacles: 'wild', Spines: 'spike',
  Antennae: 'antennae', Flowers: 'short',
});

const circle = (key, cx, cy, r, attrs = {}) => ({ key, tag: 'circle', attrs: { cx, cy, r, ...attrs } });
const path = (key, d, attrs = {}) => ({ key, tag: 'path', attrs: { d, ...attrs } });
const rect = (key, x, y, width, height, attrs = {}) => ({ key, tag: 'rect', attrs: { x, y, width, height, rx: Math.min(width, height) / 3, ...attrs } });
const num = (value) => Math.round(value * 10) / 10;
// The hair cap is a dome whose lower edge is the hairline, at the forehead, so brows and eyes stay visible below it.
const HAIRLINE = 0.66;
const cap = (cx, cy, r, extra = 1) => { const big = r + extra, drop = r * HAIRLINE, half = Math.sqrt(Math.max(0, big * big - drop * drop)); return `M${num(cx - half)} ${num(cy - drop)}A${num(big)} ${num(big)} 0 0 1 ${num(cx + half)} ${num(cy - drop)}Z`; };

// Each drawer gets the head centre and radius and returns shapes tagged for the layer behind or in front of the face.
const HAIR_DRAWERS = {
  none: () => [],
  buzz: (c, y, r) => [{ ...path('h', cap(c, y, r, 0.5)), layer: 'front', thin: true }],
  short: (c, y, r) => [{ ...path('h', cap(c, y, r, 1.5)), layer: 'front' }],
  bob: (c, y, r) => [{ ...path('h', cap(c, y, r, 1.5)), layer: 'front' }, { ...rect('l', c - r - 3, y - r * 0.2, r * 0.7, r * 1.5), layer: 'back' }, { ...rect('r', c + r - r * 0.7 + 3, y - r * 0.2, r * 0.7, r * 1.5), layer: 'back' }],
  long: (c, y, r) => [{ ...path('h', cap(c, y, r, 1.5)), layer: 'front' }, { ...rect('b', c - r - 3, y - r * 0.4, r * 2 + 6, r * 3.3), layer: 'back' }],
  wave: (c, y, r) => [{ ...path('h', cap(c, y, r, 1.5)), layer: 'front' }, { ...circle('t', c, y - r * 1.05, r * 0.62), layer: 'front' }, { ...circle('a', c - r * 1.05, y + r * 0.1, r * 0.45), layer: 'back' }, { ...circle('b', c + r * 1.05, y + r * 0.1, r * 0.45), layer: 'back' }],
  tower: (c, y, r) => [{ ...path('h', cap(c, y, r, 1.5)), layer: 'front' }, { ...path('t', `M${num(c - r * 0.75)} ${num(y - r * 0.6)}L${num(c - r * 0.35)} ${num(y - r * 2.3)}L${num(c + r * 0.35)} ${num(y - r * 2.3)}L${num(c + r * 0.75)} ${num(y - r * 0.6)}Z`), layer: 'front' }],
  box: (c, y, r) => [{ ...rect('h', c - r * 1.05, y - r * 1.6, r * 2.1, r * 1.55), layer: 'front' }],
  round: (c, y, r) => [{ ...circle('h', c, y - r * 0.3, r * 1.4), layer: 'back' }, { ...path('f', cap(c, y, r, 1.5)), layer: 'front' }],
  wedge: (c, y, r) => [{ ...path('h', `M${num(c - r - 1)} ${num(y - r * 0.1)}L${num(c - r * 0.2)} ${num(y - r * 1.9)}L${num(c + r + 1)} ${num(y - r * 0.1)}Z`), layer: 'front' }],
  flat: (c, y, r) => [{ ...rect('h', c - r * 1.2, y - r * 1.4, r * 2.4, r * 1.3, { rx: 1 }), layer: 'front' }],
  buns: (c, y, r) => [{ ...path('h', cap(c, y, r, 1.5)), layer: 'front' }, { ...circle('a', c - r * 0.95, y - r * 0.95, r * 0.5), layer: 'front' }, { ...circle('b', c + r * 0.95, y - r * 0.95, r * 0.5), layer: 'front' }],
  spike: (c, y, r) => [{ ...path('h', cap(c, y, r, 1)), layer: 'front' }, ...[-0.8, -0.4, 0, 0.4, 0.8].map((k, i) => ({ ...path(`s${i}`, `M${num(c + k * r - r * 0.22)} ${num(y - r * 0.8)}L${num(c + k * r)} ${num(y - r * (1.55 - Math.abs(k) * 0.5))}L${num(c + k * r + r * 0.22)} ${num(y - r * 0.8)}Z`), layer: 'front' }))],
  halo: (c, y, r) => [{ ...path('h', cap(c, y, r, 1)), layer: 'front' }, { ...circle('o', c, y - r * 0.9, r * 1.05, { fill: 'none', strokeWidth: r * 0.5 }), layer: 'front', ring: true }],
  braids: (c, y, r) => [{ ...path('h', cap(c, y, r, 1.5)), layer: 'front' }, { ...path('a', `M${num(c - r - 1)} ${num(y)}L${num(c - r - 1)} ${num(y + r * 3)}`, { strokeWidth: r * 0.4, strokeDasharray: '3 2' }), layer: 'back', stroked: true }, { ...path('b', `M${num(c + r + 1)} ${num(y)}L${num(c + r + 1)} ${num(y + r * 3)}`, { strokeWidth: r * 0.4, strokeDasharray: '3 2' }), layer: 'back', stroked: true }],
  pigtails: (c, y, r) => [{ ...path('h', cap(c, y, r, 1.5)), layer: 'front' }, { ...circle('a', c - r * 1.3, y + r * 0.2, r * 0.55), layer: 'back' }, { ...circle('b', c + r * 1.3, y + r * 0.2, r * 0.55), layer: 'back' }],
  pony: (c, y, r) => [{ ...path('h', cap(c, y, r, 1.5)), layer: 'front' }, { ...circle('k', c + r * 1.15, y - r * 0.5, r * 0.4), layer: 'back' }, { ...path('t', `M${num(c + r * 1.2)} ${num(y - r * 0.3)}Q${num(c + r * 2)} ${num(y + r)} ${num(c + r * 1.4)} ${num(y + r * 2)}`, { strokeWidth: r * 0.5 }), layer: 'back', stroked: true }],
  knot: (c, y, r) => [{ ...path('h', cap(c, y, r, 1.5)), layer: 'front' }, { ...circle('k', c, y - r * 1.3, r * 0.45), layer: 'front' }],
  wild: (c, y, r) => [{ ...path('h', cap(c, y, r, 2)), layer: 'front' }, ...[[-1.1, -0.3], [-0.8, -1], [0, -1.35], [0.8, -1], [1.1, -0.3]].map(([dx, dy], i) => ({ ...circle(`w${i}`, c + dx * r, y + dy * r, r * 0.5), layer: 'back' }))],
  antennae: (c, y, r) => [{ ...path('h', cap(c, y, r, 1)), layer: 'front' }, { ...path('a', `M${num(c - r * 0.4)} ${num(y - r)}L${num(c - r * 1.1)} ${num(y - r * 1.9)}`, { strokeWidth: 1.5 }), layer: 'front', stroked: true }, { ...path('b', `M${num(c + r * 0.4)} ${num(y - r)}L${num(c + r * 1.1)} ${num(y - r * 1.9)}`, { strokeWidth: 1.5 }), layer: 'front', stroked: true }, { ...circle('p', c - r * 1.1, y - r * 1.9, 2), layer: 'front' }, { ...circle('q', c + r * 1.1, y - r * 1.9, 2), layer: 'front' }],
};

const HEADWEAR = {
  'Baseball Cap': (c, y, r) => [path('d', cap(c, y, r, 2)), rect('b', c - r * 0.2, y - r * 0.45, r * 1.5, r * 0.3, { rx: 1.5 })],
  Beanie: (c, y, r) => [path('d', cap(c, y, r, 2)), rect('b', c - r - 2, y - r * 0.35, r * 2 + 4, r * 0.35, { rx: 1.5 }), circle('p', c, y - r * 1.05, r * 0.2)],
  'Wide-Brim Hat': (c, y, r) => [{ key: 'b', tag: 'ellipse', attrs: { cx: c, cy: y - r * 0.55, rx: r * 1.9, ry: r * 0.32 } }, path('d', cap(c, y - r * 0.2, r * 0.85, 0))],
  'Bucket Hat': (c, y, r) => [path('d', `M${num(c - r - 1)} ${num(y - r * 0.5)}L${num(c - r * 0.8)} ${num(y - r * 1.5)}L${num(c + r * 0.8)} ${num(y - r * 1.5)}L${num(c + r + 1)} ${num(y - r * 0.5)}Z`), { key: 'b', tag: 'ellipse', attrs: { cx: c, cy: y - r * 0.5, rx: r * 1.45, ry: r * 0.22 } }],
  Headphones: (c, y, r) => [path('d', `M${num(c - r - 1)} ${num(y)}A${num(r + 1)} ${num(r + 1)} 0 0 1 ${num(c + r + 1)} ${num(y)}`, { fill: 'none', strokeWidth: 2.5, stroke: '#6a7bd1' }), rect('a', c - r - 5, y - r * 0.25, 6, r * 0.8), rect('z', c + r - 1, y - r * 0.25, 6, r * 0.8)],
};

const pickOf = (picks, key) => picks?.[key] || DEFAULTS[key] || '';
const swatchFill = (group, name, fallback) => SWATCHES[group][name]?.fill || SWATCHES[group][fallback].fill;

/** The numbers every drawn part comes from. Exported so tests can check the mapping without reading SVG. */
export function mannequinParams(picks) {
  const build = BUILDS[pickOf(picks, 'body_type')] || BUILDS[DEFAULTS.body_type];
  const outfit = OUTFITS[pickOf(picks, 'wardrobe_style')] || OUTFITS[DEFAULTS.wardrobe_style];
  const heightScale = HEIGHT[picks?.height] || 1;
  const legPx = 64 * (build.leg || 1) * heightScale * (LIMB[picks?.leg_size] || 1);
  const torsoPx = 54 * (build.torso || 1) * heightScale * (LIMB[picks?.torso_size] || 1);
  const neckPx = NECK[picks?.neck_size] ?? NECK.Medium;
  const headR = 17 * (SIZE[picks?.head_size] || 1);
  const hairShape = HAIR_SHAPES[pickOf(picks, 'hair')] || 'short';
  const hairLift = { tower: 2.3, wild: 1.6, antennae: 1.9, halo: 1.6, wedge: 1.9, round: 1.6, spike: 1.55, box: 1.6, flat: 1.4, knot: 1.55, buns: 1.45, wave: 1.7 }[hairShape] || 1.1;
  const natural = legPx + torsoPx + neckPx + headR * 2 + headR * (hairLift - 1);
  const fit = natural > BUDGET ? BUDGET / natural : 1;
  return {
    build, outfit, hairShape, fit, headCy: FEET_Y - legPx * fit - torsoPx * fit - neckPx * fit - headR * fit + 2,
    skin: swatchFill('skin_tone', pickOf(picks, 'skin_tone'), 'Light'), hairFill: swatchFill('hair_color', pickOf(picks, 'hair_color'), 'Brown'),
    eyeFill: swatchFill('eye_color', pickOf(picks, 'eye_color'), 'Brown'), eyeScale: { Small: 0.75, Medium: 1, Large: 1.3, 'Extra Large': 1.6 }[picks?.eye_size] || 1,
    mouthScale: SIZE[picks?.mouth_size] || 1, legPx: legPx * fit, torsoPx: torsoPx * fit, neckPx: neckPx * fit, headR: headR * fit,
    armPx: 50 * heightScale * (LIMB[picks?.arm_size] || 1) * fit, armW: 5.5 * (LIMB[picks?.arm_size] || 1), legW: 8 * (LIMB[picks?.leg_size] || 1),
    handR: 3 * (LIMB[picks?.hand_size] || 1), footLen: 10 * (LIMB[picks?.foot_size] || 1),
    headwear: HEADWEAR[picks?.headwear] ? picks.headwear : '',
  };
}

/** The figure as ordered shape descriptors: { key, tag, attrs, fill, stroke? }. Fills are real colours, never theme tokens. */
export function mannequinShapes(picks) {
  const p = mannequinParams(picks), { build, outfit } = p;
  const hipY = FEET_Y - p.legPx, shoulderY = hipY - p.torsoPx, chinY = shoulderY - p.neckPx, headY = chinY - p.headR + 2, waistY = shoulderY + p.torsoPx * 0.5;
  const sw = build.s + (outfit.pad || 0), ww = build.w, hw = build.h;
  const out = [];
  const add = (shape, fill, extra = {}) => out.push({ ...shape, fill, ...extra });
  const hair = HAIR_DRAWERS[p.hairShape](CX, headY, p.headR).map((shape) => ({ ...shape, key: `hair-${shape.key}` }));
  const drawHair = (layer) => hair.filter((s) => s.layer === layer).forEach((s) => {
    const { layer: _layer, thin, ring, stroked, ...shape } = s;
    if (stroked) out.push({ ...shape, fill: 'none', stroke: p.hairFill, attrs: { ...shape.attrs, strokeLinecap: 'round' } });
    else if (ring) out.push({ ...shape, fill: 'none', stroke: p.hairFill });
    else out.push({ ...shape, fill: p.hairFill, ...(thin ? { opacity: 0.6 } : {}) });
  });

  add({ key: 'shadow', tag: 'ellipse', attrs: { cx: CX, cy: FEET_Y + 2, rx: 30, ry: 3.5 } }, '#000000', { opacity: 0.12 });
  drawHair('back');
  // Legs (skin), then the cut of the bottoms over them, then shoes.
  for (const [side, x] of [['l', CX - hw * 0.55], ['r', CX + hw * 0.55]]) {
    add(rect(`leg-${side}`, x - p.legW / 2, hipY - 2, p.legW, p.legPx, { rx: p.legW / 2 }), p.skin);
    const down = outfit.cut === 'shorts' ? 0.45 : outfit.cut === 'trousers' ? 0.97 : 0;
    if (down) add(rect(`bottom-${side}`, x - p.legW / 2 - 0.8, hipY - 2, p.legW + 1.6, p.legPx * down, { rx: 2 }), outfit.bottom);
    add({ key: `shoe-${side}`, tag: 'ellipse', attrs: { cx: x + (side === 'l' ? -p.footLen * 0.15 : p.footLen * 0.15), cy: FEET_Y, rx: p.footLen / 2 + p.legW / 3, ry: 3.6 } }, '#26262b');
  }
  if (outfit.cut === 'skirt') add(path('skirt', `M${num(CX - hw)} ${num(hipY - 3)}L${num(CX + hw)} ${num(hipY - 3)}L${num(CX + hw + 9)} ${num(hipY + p.legPx * 0.45)}L${num(CX - hw - 9)} ${num(hipY + p.legPx * 0.45)}Z`), outfit.bottom);
  // Arms: skin, a sleeve in the top's colour over the upper part, and the hands.
  for (const [side, dir] of [['l', -1], ['r', 1]]) {
    const x0 = CX + dir * (sw - 1), y0 = shoulderY + 3, x1 = CX + dir * (sw + 6 + build.s * 0.05), y1 = y0 + p.armPx;
    add(path(`arm-${side}`, `M${num(x0)} ${num(y0)}L${num(x1)} ${num(y1)}`, { strokeWidth: p.armW, strokeLinecap: 'round' }), 'none', { stroke: p.skin });
    add(path(`sleeve-${side}`, `M${num(x0)} ${num(y0)}L${num(x0 + (x1 - x0) * 0.4)} ${num(y0 + p.armPx * 0.4)}`, { strokeWidth: p.armW + 1.2, strokeLinecap: 'round' }), 'none', { stroke: outfit.top });
    add(circle(`hand-${side}`, x1, y1 + p.handR * 0.4, p.handR), p.skin);
  }
  add(path('torso', `M${num(CX - sw)} ${num(shoulderY + 2)}Q${CX} ${num(shoulderY - 5)} ${num(CX + sw)} ${num(shoulderY + 2)}L${num(CX + ww)} ${num(waistY)}L${num(CX + hw)} ${num(hipY)}L${num(CX - hw)} ${num(hipY)}L${num(CX - ww)} ${num(waistY)}Z`, { strokeLinejoin: 'round', strokeWidth: 2 }), outfit.top, { stroke: outfit.top });
  if (outfit.detail === 'stripe') add(rect('stripe', CX - 1.5, shoulderY + 2, 3, p.torsoPx - 2, { rx: 0 }), outfit.bottom, { opacity: 0.85 });
  if (outfit.detail === 'collar') add(path('collar', `M${num(CX - 6)} ${num(shoulderY - 1)}L${CX} ${num(shoulderY + 9)}L${num(CX + 6)} ${num(shoulderY - 1)}Z`), outfit.bottom, { opacity: 0.9 });
  add(rect('neck', CX - 4.5, chinY - 1, 9, p.neckPx + 4, { rx: 2 }), p.skin);
  const face = faceShapes(picks, p), faceMove = `translate(${num(CX)} ${num(headY)}) scale(${num(p.headR * face.scale)})`;
  for (const shape of face.shapes) {
    const { fill, stroke, opacity, strokeWidth, ...rest } = shape;
    out.push({ ...rest, attrs: { ...rest.attrs, transform: rest.attrs.transform ? `${faceMove} ${rest.attrs.transform}` : faceMove, ...(strokeWidth ? { strokeWidth } : {}) }, fill, ...(stroke ? { stroke } : {}), ...(opacity ? { opacity } : {}) });
  }
  drawHair('front');
  if (p.headwear) HEADWEAR[p.headwear](CX, headY, p.headR).forEach((shape) => add({ ...shape, key: `wear-${shape.key}` }, shape.attrs.fill === 'none' ? 'none' : '#6a7bd1'));
  return out;
}

/** What part of the figure a tile should show: the head for hair and hats, the whole figure otherwise. */
export function mannequinViewBox(focus, picks) {
  const p = mannequinParams(picks);
  if (focus === 'face') { const half = p.headR * 1.5; return `${num(CX - half)} ${num(p.headCy - half * 1.02)} ${num(half * 2)} ${num(half * 2)}`; }
  if (focus !== 'head') return `0 0 ${MANNEQUIN_BOX.width} ${MANNEQUIN_BOX.height}`;
  const top = FEET_Y - p.legPx - p.torsoPx - p.neckPx - p.headR * 2 - p.headR * 1.5;
  return `${CX - 36} ${num(top)} 72 ${num(p.headR * 2 + p.headR * 3)}`;
}
