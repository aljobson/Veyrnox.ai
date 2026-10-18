// Character types on the preview face. Human is the plain face; every other type changes the skin colour and adds the parts that make it
// read as that creature (ears, antennae, a snout, a beak...). Same unit space as oddlingFace.js. A picked skin tone is kept for human-like
// types, and the creature's own colour wins for animals and insects, because that is what the type means.
import { darken, lighten } from './oddlingColour.js';

const num = (value) => Math.round(value * 1000) / 1000;
const path = (key, d, fill, extra = {}) => ({ key, tag: 'path', attrs: { d, ...(extra.width ? { strokeWidth: extra.width, strokeLinecap: 'round', strokeLinejoin: 'round' } : {}) }, fill: extra.stroke ? 'none' : fill, ...(extra.stroke ? { stroke: extra.stroke } : {}), ...(extra.opacity ? { opacity: extra.opacity } : {}) });
const circle = (key, cx, cy, r, fill, extra = {}) => ({ key, tag: 'circle', attrs: { cx: num(cx), cy: num(cy), r: num(r) }, fill, ...extra });
const both = (make) => [-1, 1].flatMap((dir) => make(dir));
const antenna = (dir, tip, colour, feathered) => [path(`sp-ant-${dir}`, `M${dir * 0.3} -0.9Q${dir * tip[0] * 0.6} ${tip[1] * 0.8} ${dir * tip[0]} ${tip[1]}`, colour, { stroke: colour, width: 0.05 }), feathered ? path(`sp-ant-f-${dir}`, `M${dir * tip[0] * 0.55} ${tip[1] * 0.78}l${dir * 0.16} -0.04M${dir * tip[0] * 0.7} ${tip[1] * 0.86}l${dir * 0.16} -0.02M${dir * tip[0] * 0.85} ${tip[1] * 0.94}l${dir * 0.14} 0`, colour, { stroke: colour, width: 0.03 }) : circle(`sp-ant-b-${dir}`, dir * tip[0], tip[1], 0.06, colour)];
const pointedEars = (dir, colour, tall, w = 0.35) => path(`sp-ear-${dir}`, `M${dir * 0.5} -0.8L${dir * (0.5 + w)} ${-0.8 - tall}L${dir * 0.88} -0.4Z`, colour);
const whiskers = (colour) => both((dir) => [path(`sp-wh-${dir}a`, `M${dir * 0.2} 0.35L${dir * 0.95} 0.28`, colour, { stroke: colour, width: 0.02 }), path(`sp-wh-${dir}b`, `M${dir * 0.2} 0.42L${dir * 0.95} 0.46`, colour, { stroke: colour, width: 0.02 })]);

/**
 * Each type: skin colour (or null to keep the person's), `back` shapes drawn behind the head, `front` shapes drawn over the face before the
 * eyes (snouts, patches), `top` shapes drawn last (antennae, crests), and how the eyes look.
 */
const TYPES = {
  Human: { skin: null },
  Elf: { skin: null, back: (c) => both((dir) => [pointedEars(dir, c.skin, 0.55, 0.55)]) },
  Alien: { skin: '#8fb49a', eyes: { big: 1.6, colour: '#0c0c10' }, back: () => both((dir) => antenna(dir, [0.55, -1.5], '#8fb49a')) },
  Moth: { skin: '#b3a08a', eyes: { big: 1.35, colour: '#1b1410' }, back: () => both((dir) => antenna(dir, [0.85, -1.55], '#8a7860', true)), top: () => both((dir) => [path(`sp-wing-${dir}`, `M${dir * 0.7} -0.5Q${dir * 1.5} -1.1 ${dir * 1.55} -0.2Q${dir * 1.2} 0.2 ${dir * 0.85} 0`, '#cdbfae', { opacity: 0.7 })]) },
  Spectre: { skin: '#cfe0f2', eyes: { colour: '#3b4a66' }, top: () => [circle('sp-glow', 0, 0, 1.25, '#b9d6ff', { opacity: 0.22 }), path('sp-wisp', 'M-0.7 0.9Q-0.5 1.5 -0.3 1.1Q-0.1 1.6 0.1 1.1Q0.3 1.6 0.5 1.1Q0.7 1.4 0.75 0.9Z', '#cfe0f2', { opacity: 0.6 })] },
  Fungus: { skin: '#e6d9c2', top: () => [path('sp-cap', 'M-1.25 -0.62Q-1.2 -1.75 0 -1.78Q1.2 -1.75 1.25 -0.62Q0 -0.82 -1.25 -0.62Z', '#c8433b'), circle('sp-cap1', -0.6, -1.25, 0.14, '#f6efe0'), circle('sp-cap2', 0.15, -1.45, 0.17, '#f6efe0'), circle('sp-cap3', 0.7, -1.15, 0.12, '#f6efe0')] },
  Amphibian: { skin: '#7cb86a', eyes: { bulge: true, colour: '#d6c22c' }, front: () => [path('sp-mouthline', 'M-0.75 0.45Q0 0.8 0.75 0.45', '#2f5a28', { stroke: '#2f5a28', width: 0.05 })] },
  Reptile: { skin: '#5f9a5a', eyes: { slit: true, colour: '#e0c63a' }, top: () => [0.0, 0.3, -0.3].map((x, k) => path(`sp-crest-${k}`, `M${x - 0.1} -0.95L${x} ${-1.25 + Math.abs(x) * 0.5}L${x + 0.1} -0.95Z`, '#3f7a3c')) },
  Mantis: { skin: '#7fb04e', eyes: { big: 1.5, colour: '#14240c' }, back: () => both((dir) => antenna(dir, [0.5, -1.55], '#5f8a3a')), front: () => [path('sp-mantis', 'M-0.8 -0.5L0 1.15L0.8 -0.5Z', '#6f9e42', { opacity: 0.55 })] },
  Bee: { skin: '#e6b93a', eyes: { big: 1.3, colour: '#1c1608' }, back: () => both((dir) => antenna(dir, [0.55, -1.45], '#2a2418')), front: () => [-0.45, -0.1, 0.25].map((y, k) => path(`sp-stripe-${k}`, `M-0.8 ${y}Q0 ${y + 0.1} 0.8 ${y}`, '#2a2418', { stroke: '#2a2418', width: 0.09, opacity: 0.8 })) },
  Octopus: { skin: '#b06fc0', eyes: { colour: '#f4d35e' }, back: () => [-0.8, -0.45, -0.1, 0.25, 0.6].map((x, k) => path(`sp-tent-${k}`, `M${x * 0.9} 0.6Q${x * 1.3} 1.5 ${x * 0.8 + (k % 2 ? 0.2 : -0.2)} 2Q${x * 1.1 + 0.1} 1.2 ${x * 0.9 + 0.12} 0.7Z`, '#9a5aa8')) },
  Crocodile: { skin: '#5a8a4e', eyes: { top: true, colour: '#d8c43a', slit: true }, front: () => [path('sp-snout', 'M-0.5 0 Q0 -0.15 0.5 0L0.62 0.95Q0 1.2 -0.62 0.95Z', '#4d7a42'), circle('sp-nostril-l', -0.2, 0.15, 0.04, '#1c2e18'), circle('sp-nostril-r', 0.2, 0.15, 0.04, '#1c2e18')] },
  Iguana: { skin: '#6fa86a', eyes: { slit: true, colour: '#d8b43a' }, top: () => [-0.5, -0.25, 0, 0.25, 0.5].map((x, k) => path(`sp-spine-${k}`, `M${x - 0.07} -0.95L${x} ${-1.3 + Math.abs(x) * 0.4}L${x + 0.07} -0.95Z`, '#3f7a3c')), front: () => [path('sp-dewlap', 'M-0.3 0.95Q0 1.7 0.3 0.95Z', '#e06a3a')] },
  Lizard: { skin: '#a8a050', eyes: { slit: true, colour: '#4a3c10' }, front: () => [path('sp-lz-stripe', 'M-0.8 -0.1Q0 -0.3 0.8 -0.1', '#7d7436', { stroke: '#7d7436', width: 0.06, opacity: 0.8 })] },
  Beetle: { skin: '#2f3a52', eyes: { colour: '#c8a23a' }, back: () => both((dir) => antenna(dir, [0.55, -1.4], '#1b2235')), top: () => [path('sp-bhorn', 'M-0.12 -0.9Q-0.2 -1.5 0 -1.85Q0.2 -1.5 0.12 -0.9Z', '#1b2235'), path('sp-sheen', 'M-0.5 -0.7Q-0.2 -0.9 0.1 -0.85', '#8fa3d6', { stroke: '#8fa3d6', width: 0.05, opacity: 0.7 })] },
  Ant: { skin: '#7a3b26', eyes: { colour: '#140a06' }, back: () => both((dir) => antenna(dir, [0.55, -1.5], '#4a2214')), front: () => both((dir) => [path(`sp-mand-${dir}`, `M${dir * 0.2} 0.75Q${dir * 0.55} 0.85 ${dir * 0.4} 1.15Q${dir * 0.2} 1.0 ${dir * 0.12} 0.8Z`, '#3a1a0e')]) },
  Cat: { skin: '#caa57a', eyes: { slit: true, colour: '#7ab34a' }, back: (c) => both((dir) => [pointedEars(dir, c.skin, 0.55)]), front: () => [path('sp-cat-nose', 'M-0.07 0.12h0.14l-0.07 0.1Z', '#d9788a'), ...whiskers('#f2ece0')] },
  Dog: { skin: '#b98a58', eyes: { colour: '#3a2412' }, back: () => both((dir) => [path(`sp-dog-ear-${dir}`, `M${dir * 0.75} -0.8Q${dir * 1.45} -0.5 ${dir * 1.3} 0.4Q${dir * 1.0} 0.3 ${dir * 0.88} -0.2Z`, '#8a6034')]), front: () => [{ key: 'sp-dog-snout', tag: 'ellipse', attrs: { cx: 0, cy: 0.38, rx: 0.38, ry: 0.3 }, fill: '#d8b88a' }, { key: 'sp-dog-nose', tag: 'ellipse', attrs: { cx: 0, cy: 0.2, rx: 0.12, ry: 0.08 }, fill: '#1c1412' }] },
  Rodent: { skin: '#b4a08a', eyes: { colour: '#140f0a' }, back: () => both((dir) => [circle(`sp-rod-ear-${dir}`, dir * 0.72, -0.85, 0.34, '#b4a08a'), circle(`sp-rod-ear-in-${dir}`, dir * 0.72, -0.85, 0.2, '#e0a8a0')]), front: () => [path('sp-rod-teeth', 'M-0.1 0.6h0.2v0.26h-0.2Z', '#f6f2e8'), circle('sp-rod-nose', 0, 0.24, 0.06, '#d9788a'), ...whiskers('#f2ece0')] },
  Bird: { skin: '#c9a36a', eyes: { colour: '#14100a', side: true }, top: () => [path('sp-crest', 'M-0.2 -0.95Q-0.1 -1.6 0.15 -1.7Q0.1 -1.2 0.3 -0.95Z', '#d6563a')], front: () => [path('sp-beak', 'M-0.25 0.1L0 0.85L0.25 0.1Z', '#e8a23a')] },
};

/** Species work for a face: { skin, eyes, back, front, top } or null for Human. `p.skin` is the colour to keep when the type has none. */
export function speciesFx(picks, p) {
  const type = TYPES[picks?.character_type];
  if (!type || !picks?.character_type || picks.character_type === 'Human') return null;
  const skin = type.skin && !picks?.skin_tone ? type.skin : (type.skin && type.skin !== null ? type.skin : p.skin);
  const ctx = { skin };
  return { skin, eyes: type.eyes || null, back: type.back ? type.back(ctx) : [], front: type.front ? type.front(ctx) : [], top: type.top ? type.top(ctx) : [], hasSnout: ['Crocodile', 'Dog', 'Bird'].includes(picks.character_type) };
}

export const SPECIES_TABLE = Object.freeze(Object.keys(TYPES));
