// Skin on the preview face: conditions (freckles, scars, ...), materials (scales, fur, metal, ...) and surface patterns (stripes, spots, ...).
// Same unit space as oddlingFace.js (head radius 1). Every mark is kept inside the head, so nothing leaks outside the face.
import { darken, lighten } from './oddlingColour.js';

const num = (value) => Math.round(value * 1000) / 1000;
const inside = (x, y, grow = 0) => ((x / (0.86 + grow)) ** 2) + ((y / (0.95 + grow)) ** 2) < 1;
// A fixed, repeatable scatter: the same picks must always draw the same face.
const scatter = (count, seed) => Array.from({ length: count }, (_, i) => { const a = ((i * 2654435761 + seed * 97) % 1000) / 1000, b = ((i * 40503 + seed * 31) % 1000) / 1000; return [a * 1.7 - 0.85, b * 1.8 - 0.9]; }).filter(([x, y]) => inside(x, y, -0.06));
const dot = (key, x, y, r, fill, opacity) => ({ key, tag: 'circle', attrs: { cx: num(x), cy: num(y), r: num(r) }, fill, ...(opacity ? { opacity } : {}) });
const line = (key, d, stroke, width, opacity) => ({ key, tag: 'path', attrs: { d, strokeWidth: width, strokeLinecap: 'round', strokeLinejoin: 'round' }, fill: 'none', stroke, ...(opacity ? { opacity } : {}) });
const blob = (key, d, fill, opacity) => ({ key, tag: 'path', attrs: { d }, fill, ...(opacity ? { opacity } : {}) });

const MATERIALS = {
  'Human Skin': () => ({}),
  Scales: () => ({ skin: '#6fa66a', marks: (c) => rows(0.2, 'M', (x, y, k) => line(`scale-${k}`, `M${num(x - 0.09)} ${num(y)}q0.09 0.13 0.18 0`, darken(c, 0.35), 0.03)) }),
  Fur: ({ hairFill }) => ({ skin: lighten(hairFill, 0.12), marks: (c) => scatter(70, 3).map(([x, y], k) => line(`fur-${k}`, `M${num(x)} ${num(y)}l${num(((k % 5) - 2) * 0.025)} 0.08`, darken(c, 0.35), 0.02)) }),
  Amphibian: () => ({ skin: '#7cb86a', marks: (c) => [...scatter(11, 5).map(([x, y], k) => dot(`am-${k}`, x, y, 0.045, darken(c, 0.3))), { key: 'am-shine', tag: 'ellipse', attrs: { cx: -0.35, cy: -0.55, rx: 0.22, ry: 0.09, transform: 'rotate(-25 -0.35 -0.55)' }, fill: '#ffffff', opacity: 0.35 }] }),
  'Fish Skin': () => ({ skin: '#8fb6c9', marks: (c) => [...rows(0.18, 'F', (x, y, k) => line(`fish-${k}`, `M${num(x - 0.08)} ${num(y)}q0.08 -0.1 0.16 0`, lighten(c, 0.5), 0.026)), { key: 'fish-sheen', tag: 'ellipse', attrs: { cx: 0.2, cy: -0.45, rx: 0.4, ry: 0.07, transform: 'rotate(15 0.2 -0.45)' }, fill: '#ffffff', opacity: 0.3 }] }),
  Metallic: () => ({ skin: '#aab1ba', marks: () => [{ key: 'met-band', tag: 'path', attrs: { d: 'M-0.8 -0.5Q0 -0.75 0.8 -0.5L0.7 -0.28Q0 -0.5 -0.7 -0.28Z' }, fill: '#e9edf2', opacity: 0.6 }, { key: 'met-shade', tag: 'path', attrs: { d: 'M-0.7 0.55Q0 0.85 0.7 0.55L0.5 0.9Q0 1.05 -0.5 0.9Z' }, fill: '#5d646e', opacity: 0.5 }, dot('met-rivet-l', -0.74, 0.1, 0.035, '#5d646e'), dot('met-rivet-r', 0.74, 0.1, 0.035, '#5d646e')] }),
  Porcelain: () => ({ skin: '#f4ece6', marks: () => [{ key: 'por-gloss', tag: 'ellipse', attrs: { cx: -0.35, cy: -0.5, rx: 0.2, ry: 0.1, transform: 'rotate(-30 -0.35 -0.5)' }, fill: '#ffffff', opacity: 0.8 }, line('por-hair', 'M0.5 -0.7L0.4 -0.45L0.5 -0.3L0.38 -0.1', '#b9aea8', 0.015)] }),
  Glass: () => ({ skin: '#cfe6ee', marks: () => [{ key: 'glass-gloss', tag: 'path', attrs: { d: 'M-0.62 -0.5Q-0.35 -0.8 0 -0.82', strokeWidth: 0.07, strokeLinecap: 'round' }, fill: 'none', stroke: '#ffffff', opacity: 0.85 }, line('glass-edge', 'M0.7 -0.3Q0.82 0 0.68 0.35', '#ffffff', 0.04, 0.7), line('glass-edge2', 'M-0.5 0.7Q0 0.95 0.5 0.7', '#9ec3d0', 0.03, 0.7)] }),
};
/** A staggered grid of marks inside the head. `make(x, y, index)` returns one shape. */
function rows(step, _kind, make) { const out = []; let k = 0; for (let y = -0.8, r = 0; y < 0.95; y += step * 0.72, r++) for (let x = -0.85 + (r % 2) * step / 2; x < 0.86; x += step) if (inside(x, y, -0.05)) out.push(make(x, y, k++)); return out; }

const CONDITIONS = {
  Vitiligo: ({ skin }) => ({ marks: [blob('vit-1', 'M-0.6 -0.3q0.2 -0.2 0.3 0q0 0.2 -0.2 0.25q-0.2 -0.05 -0.1 -0.25Z', lighten(skin, 0.55)), blob('vit-2', 'M0.3 0.2q0.25 -0.15 0.35 0.05q0 0.22 -0.25 0.2q-0.15 -0.1 -0.1 -0.25Z', lighten(skin, 0.55)), blob('vit-3', 'M-0.2 0.6q0.2 -0.1 0.3 0.05q-0.05 0.2 -0.25 0.15Z', lighten(skin, 0.55)), blob('vit-4', 'M0.1 -0.65q0.2 -0.05 0.22 0.1q-0.1 0.15 -0.25 0.05Z', lighten(skin, 0.55))] }),
  Pigmentation: ({ skin }) => ({ marks: [{ key: 'pig-1', tag: 'ellipse', attrs: { cx: -0.5, cy: 0.2, rx: 0.2, ry: 0.13 }, fill: darken(skin, 0.28), opacity: 0.6 }, { key: 'pig-2', tag: 'ellipse', attrs: { cx: 0.45, cy: -0.4, rx: 0.17, ry: 0.1 }, fill: darken(skin, 0.28), opacity: 0.6 }, { key: 'pig-3', tag: 'ellipse', attrs: { cx: 0.2, cy: 0.62, rx: 0.15, ry: 0.09 }, fill: darken(skin, 0.28), opacity: 0.6 }] }),
  Freckles: ({ skin }) => ({ marks: Array.from({ length: 26 }, (_, i) => { const side = i % 2 ? 1 : -1, x = side * (0.12 + (((i * 37) % 10) / 10) * 0.6), y = 0.0 + (((i * 53) % 10) / 10) * 0.32; return dot(`fr-${i}`, x, y, 0.028, darken(skin, 0.38)); }) }),
  Birthmarks: () => ({ marks: [blob('bm-1', 'M0.38 0.05q0.2 -0.12 0.32 0.04q0.06 0.22 -0.18 0.28q-0.2 -0.08 -0.14 -0.32Z', '#7b2f3a', 0.8), dot('bm-2', -0.3, -0.62, 0.06, '#7b2f3a', 0.8)] }),
  Scars: ({ skin }) => ({ marks: [line('sc-1', 'M0.45 -0.2L0.7 0.35', lighten(skin, 0.4), 0.04), line('sc-1a', 'M0.5 -0.05l0.1 -0.03M0.56 0.08l0.1 -0.03M0.62 0.21l0.1 -0.03', lighten(skin, 0.4), 0.02), line('sc-2', 'M-0.55 -0.55L-0.2 -0.35', lighten(skin, 0.4), 0.035)] }),
  Burns: () => ({ marks: [blob('bu-1', 'M-0.78 -0.1q0.25 -0.35 0.5 -0.15q0.1 0.3 -0.05 0.55q-0.3 0.2 -0.45 -0.1Z', '#b5523c', 0.75), ...scatter(14, 8).filter(([x]) => x < -0.3).map(([x, y], k) => dot(`bu-d${k}`, x, y * 0.6, 0.025, '#7d2b22', 0.7))] }),
  Albinism: () => ({ skin: '#f3e7e1', eyeFill: '#d98ca0', marks: [] }),
  'Cracked Skin': ({ skin }) => ({ marks: [line('cr-1', 'M-0.5 -0.6L-0.35 -0.3L-0.55 -0.1L-0.4 0.2', darken(skin, 0.5), 0.025), line('cr-2', 'M0.55 -0.1L0.38 0.1L0.52 0.3L0.36 0.5', darken(skin, 0.5), 0.025), line('cr-3', 'M-0.1 0.7L0.05 0.82L-0.05 0.92', darken(skin, 0.5), 0.02)] }),
  Wrinkled: ({ skin }) => ({ marks: [line('wr-1', 'M-0.5 -0.62Q0 -0.7 0.5 -0.62', darken(skin, 0.3), 0.025), line('wr-2', 'M-0.45 -0.52Q0 -0.6 0.45 -0.52', darken(skin, 0.3), 0.02), line('wr-3', 'M-0.78 -0.12l-0.1 -0.05M-0.78 -0.06l-0.12 0.02M0.78 -0.12l0.1 -0.05M0.78 -0.06l0.12 0.02', darken(skin, 0.3), 0.02), line('wr-4', 'M-0.3 0.4Q-0.35 0.55 -0.28 0.7M0.3 0.4Q0.35 0.55 0.28 0.7', darken(skin, 0.3), 0.02)] }),
};

const PATTERNS = {
  Solid: () => [],
  Stripes: (c) => [-0.6, -0.3, 0, 0.3, 0.6].map((x, k) => { const h = Math.sqrt(Math.max(0, 1 - (x / 0.86) ** 2)) * 0.95 - 0.04; return line(`pat-s${k}`, `M${x} ${num(-h)}L${x} ${num(h)}`, darken(c, 0.5), 0.1, 0.4); }),
  Spots: (c) => scatter(15, 11).map(([x, y], k) => dot(`pat-p${k}`, x, y, 0.06 + (k % 3) * 0.015, darken(c, 0.45), 0.45)),
  Chess: (c) => { const out = []; let k = 0; for (let iy = -3; iy <= 3; iy++) for (let ix = -3; ix <= 3; ix++) { const x = ix * 0.28, y = iy * 0.28; if ((ix + iy) % 2 === 0 && inside(x, y, -0.08)) out.push({ key: `pat-c${k++}`, tag: 'rect', attrs: { x: num(x - 0.14), y: num(y - 0.14), width: 0.28, height: 0.28 }, fill: darken(c, 0.55), opacity: 0.4 }); } return out; },
  Veins: () => [line('pat-v1', 'M-0.7 -0.1Q-0.4 -0.3 -0.3 -0.55M-0.5 -0.22L-0.62 -0.45', '#b53a4a', 0.025, 0.7), line('pat-v2', 'M0.7 0.1Q0.45 0.35 0.3 0.7M0.5 0.28L0.66 0.45', '#b53a4a', 0.025, 0.7), line('pat-v3', 'M0.2 -0.8Q0.5 -0.6 0.6 -0.35', '#b53a4a', 0.022, 0.7)],
  Gradient: () => [{ key: 'pat-g1', tag: 'ellipse', attrs: { cx: 0, cy: 0.55, rx: 0.8, ry: 0.42 }, fill: '#7a4ac0', opacity: 0.4 }, { key: 'pat-g2', tag: 'ellipse', attrs: { cx: 0, cy: 0.7, rx: 0.6, ry: 0.28 }, fill: '#c24a8c', opacity: 0.35 }],
  Cracked: (c) => [line('pat-k1', 'M0 -0.9L0.1 -0.55L-0.1 -0.3L0.08 0L-0.06 0.3L0.1 0.65', darken(c, 0.55), 0.03), line('pat-k2', 'M0.1 -0.55L0.4 -0.5M-0.1 -0.3L-0.45 -0.2M0.08 0L0.45 0.12M-0.06 0.3L-0.4 0.4', darken(c, 0.55), 0.022)],
  Giraffe: (c) => [['-0.5 -0.45', 0.2], ['0.3 -0.55', 0.17], ['-0.2 0', 0.19], ['0.55 0.1', 0.18], ['-0.55 0.45', 0.16], ['0.1 0.55', 0.17]].map(([at, r], k) => { const [x, y] = at.split(' ').map(Number); return blob(`pat-g${k}`, `M${num(x - r)} ${num(y)}L${num(x - r * 0.3)} ${num(y - r)}L${num(x + r * 0.8)} ${num(y - r * 0.6)}L${num(x + r)} ${num(y + r * 0.4)}L${num(x)} ${num(y + r)}Z`, darken(c, 0.5), 0.45); }),
};

/** Skin work for a face: { skin, eyeFill, marks } where `marks` are shapes in unit space, to draw right after the head. */
export function skinFx(picks, p) {
  const material = (MATERIALS[picks?.face_skin_material] || MATERIALS['Human Skin'])(p);
  let skin = material.skin || p.skin, eyeFill = p.eyeFill;
  const condition = CONDITIONS[picks?.skin_conditions];
  const made = condition ? condition({ ...p, skin }) : null;
  if (made?.skin) skin = made.skin;
  if (made?.eyeFill) eyeFill = made.eyeFill;
  const marks = [...(material.marks ? material.marks(skin) : []), ...(PATTERNS[picks?.face_surface_pattern] || PATTERNS.Solid)(skin), ...(made?.marks || [])];
  return { skin, eyeFill, marks };
}

export const SKIN_TABLES = Object.freeze({ face_skin_material: Object.keys(MATERIALS), skin_conditions: Object.keys(CONDITIONS), face_surface_pattern: Object.keys(PATTERNS) });
