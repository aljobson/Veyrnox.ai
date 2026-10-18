// The face of the Oddling preview figure. Pure geometry in a unit space (head radius 1, centre 0,0, y grows downward), so each feature is a
// small table row and a test can check that every option of every face group has its own drawing. The mannequin moves and scales this
// space onto the figure with one transform. Stylised on purpose: the final picture is made by AI from the same picks.

export const EYE_Y = -0.12;
export const EYE_GAP = 0.42;
const num = (value) => Math.round(value * 1000) / 1000;
const mix = (hex, toward, amount) => {
  const parse = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const a = parse(hex), b = parse(toward);
  return `#${a.map((v, i) => Math.round(v + (b[i] - v) * amount).toString(16).padStart(2, '0')).join('')}`;
};
export const darken = (hex, amount) => mix(hex, '#000000', amount);
export const lighten = (hex, amount) => mix(hex, '#ffffff', amount);

// ---- head outline: half-widths down the right side (forehead, brow, cheek, jaw, chin), smoothed through a closed spline ----
const HEAD_BASE = { 'Perfect Round': [0.62, 0.97, 0.98, 0.82, 0.48], 'Long Oval': [0.5, 0.72, 0.74, 0.6, 0.3], Square: [0.8, 0.94, 0.95, 0.9, 0.62], Heart: [0.86, 1, 0.82, 0.52, 0.2], Diamond: [0.46, 0.86, 1, 0.58, 0.2], 'Tiny Head': [0.62, 0.97, 0.98, 0.82, 0.48], 'Oversized Head': [0.62, 0.97, 0.98, 0.82, 0.48] };
const HEAD_SCALE = { 'Tiny Head': 0.78, 'Oversized Head': 1.18 };
const JAW = { 'Strong Jaw': { w: [0, 0, 0, 0.14, 0.24], flat: 0.55 }, 'Soft Jaw': { w: [0, 0, 0, -0.06, 0.06] }, 'Pointed Chin': { w: [0, 0, 0, -0.06, -0.2], drop: 0.12 }, 'Round Chin': { w: [0, 0, 0, 0.02, 0.14] }, 'Cleft Chin': { w: [0, 0, 0, 0, 0.04], cleft: true }, 'Prominent Chin': { w: [0, 0, 0, 0, 0.08], drop: 0.16 } };
const Y = [-0.74, -0.3, 0.1, 0.52, 0.86];

function smoothClosed(points) {
  const n = points.length;
  let d = `M${num(points[0][0])} ${num(points[0][1])}`;
  for (let i = 0; i < n; i++) {
    const p0 = points[(i - 1 + n) % n], p1 = points[i], p2 = points[(i + 1) % n], p3 = points[(i + 2) % n];
    d += `C${num(p1[0] + (p2[0] - p0[0]) / 6)} ${num(p1[1] + (p2[1] - p0[1]) / 6)} ${num(p2[0] - (p3[0] - p1[0]) / 6)} ${num(p2[1] - (p3[1] - p1[1]) / 6)} ${num(p2[0])} ${num(p2[1])}`;
  }
  return `${d}Z`;
}

/** The head outline for a head shape and jaw pick: { d, scale, cleft }. */
export function headOutline(headShape, jawPick) {
  const base = HEAD_BASE[headShape] || HEAD_BASE['Perfect Round'], jaw = JAW[jawPick];
  const w = base.map((value, i) => Math.max(0.12, value + (jaw?.w[i] || 0)));
  const bottom = 1 + (jaw?.drop || 0);
  const right = w.map((half, i) => [half, Y[i]]);
  const chin = jaw?.flat ? [[w[4] * jaw.flat, bottom], [-w[4] * jaw.flat, bottom]] : [[0, bottom]];
  const points = [[0, -1], ...right, ...chin, ...[...right].reverse().map(([x, y]) => [-x, y])];
  return { d: smoothClosed(points), scale: HEAD_SCALE[headShape] || 1, cleft: !!jaw?.cleft, jawWidth: w[3], chinY: bottom };
}

// ---- eyes ----
const EYE_SHAPES = {
  Round: { rx: 0.17, ry: 0.17 }, Narrow: { rx: 0.2, ry: 0.07 }, Downturned: { rx: 0.19, ry: 0.1, tilt: 14 }, Upturned: { rx: 0.19, ry: 0.1, tilt: -14 }, Almond: { rx: 0.2, ry: 0.11, tilt: -6 },
  Monolid: { rx: 0.2, ry: 0.085, lid: 'flat' }, Hooded: { rx: 0.19, ry: 0.12, lid: 'hood' }, Uneven: { rx: 0.17, ry: 0.15, right: { rx: 0.15, ry: 0.09, dy: 0.05 } },
  'Wide Set': { rx: 0.17, ry: 0.12, gap: 0.6 }, 'Close Set': { rx: 0.17, ry: 0.12, gap: 0.27 }, 'Graphic Liner': { rx: 0.19, ry: 0.11, liner: true },
};
const EYE_DEFAULT = { rx: 0.17, ry: 0.12 };
const EYE_TYPES = { Human: {}, Reptile: { iris: '#d6c22c', slit: true }, Mechanical: { iris: '#8a94a0', ring: true } };

function eyeShapes(picks, p) {
  const spec = EYE_SHAPES[picks?.eye_shape] || EYE_DEFAULT, type = EYE_TYPES[picks?.eyes_type] || EYE_TYPES.Human, detail = picks?.eyes_details || '';
  const out = [];
  for (const [side, dir] of [['l', -1], ['r', 1]]) {
    const own = dir === 1 && spec.right ? { ...spec, ...spec.right } : spec;
    const gap = spec.gap || EYE_GAP, cx = dir * gap, cy = EYE_Y + (own.dy || 0) + 0;
    const rx = own.rx * p.eyeScale, ry = own.ry * p.eyeScale, tilt = (spec.tilt || 0) * dir * -1;
    let iris = detail === 'Heterochromia' && dir === 1 ? '#3f7fd0' : (type.iris || p.eyeFill);
    if (detail === 'Heterochromia' && dir === 1 && p.eyeFill === '#3f7fd0') iris = '#c8323a';
    const blind = detail === 'Blind Eye' && dir === 1;
    const at = `translate(${num(cx)} ${num(cy)}) rotate(${tilt})`;
    if (detail === 'Glowing Eye' && dir === 1) out.push({ key: `eye-glow-${side}`, tag: 'circle', attrs: { cx: num(cx), cy: num(cy), r: num(Math.max(rx, ry) * 2.1) }, fill: '#7af0ff', opacity: 0.38 });
    out.push({ key: `eye-white-${side}`, tag: 'ellipse', attrs: { cx: 0, cy: 0, rx: num(rx), ry: num(ry), transform: at }, fill: blind ? '#e6e6ee' : '#f4f4f1', stroke: darken(p.skin, 0.55), strokeWidth: 0.035 });
    // The iris keeps the key `eye-l` / `eye-r`: the picked colour is what a person looks for.
    const ir = Math.min(ry * 0.92, rx * 0.8);
    if (!blind) {
      out.push({ key: `eye-${side}`, tag: 'circle', attrs: { cx: 0, cy: 0, r: num(ir), transform: at }, fill: detail === 'Glowing Eye' && dir === 1 ? '#bff8ff' : iris, stroke: type.ring ? '#3a4048' : undefined, strokeWidth: type.ring ? 0.035 : undefined });
      out.push(type.slit
        ? { key: `eye-pupil-${side}`, tag: 'ellipse', attrs: { cx: 0, cy: 0, rx: num(ir * 0.2), ry: num(ir * 0.95), transform: at }, fill: '#101012' }
        : { key: `eye-pupil-${side}`, tag: 'circle', attrs: { cx: 0, cy: 0, r: num(ir * (type.ring ? 0.35 : 0.5)), transform: at }, fill: type.ring ? '#c8323a' : '#101012' });
    } else out.push({ key: `eye-${side}`, tag: 'circle', attrs: { cx: 0, cy: 0, r: num(ir * 0.55), transform: at }, fill: '#d9d9e6' });
    if (spec.lid === 'flat') out.push({ key: `eye-lid-${side}`, tag: 'path', attrs: { d: `M${num(-rx)} ${num(-ry * 0.2)}L${num(rx)} ${num(-ry * 0.2)}`, transform: at, strokeWidth: 0.05 }, fill: 'none', stroke: darken(p.skin, 0.5) });
    if (spec.lid === 'hood') out.push({ key: `eye-lid-${side}`, tag: 'path', attrs: { d: `M${num(-rx * 1.15)} ${num(-ry * 0.1)}Q0 ${num(-ry * 1.9)} ${num(rx * 1.15)} ${num(-ry * 0.1)}L${num(rx * 1.15)} ${num(-ry * 1.4)}L${num(-rx * 1.15)} ${num(-ry * 1.4)}Z`, transform: at }, fill: darken(p.skin, 0.12) });
    if (spec.liner) out.push({ key: `eye-liner-${side}`, tag: 'path', attrs: { d: `M${num(-rx)} 0Q0 ${num(-ry * 1.4)} ${num(rx)} 0L${num(rx + 0.12)} ${num(-ry * 1.1)}`, transform: at, strokeWidth: 0.055 }, fill: 'none', stroke: '#17171a' });
    if (detail === 'Scarred Eye' && dir === 1) out.push({ key: 'eye-scar', tag: 'path', attrs: { d: `M${num(cx + 0.08)} ${num(cy - 0.34)}L${num(cx - 0.1)} ${num(cy + 0.36)}`, strokeWidth: 0.05 }, fill: 'none', stroke: '#9c3d3d' });
  }
  return out;
}

// ---- brows, plus the face details that replace or add to them ----
const BROWS = { Thick: { w: 0.1, arch: 0.04 }, Thin: { w: 0.035, arch: 0.05 }, Arched: { w: 0.06, arch: 0.15 }, Straight: { w: 0.07, arch: 0 }, Bushy: { w: 0.14, arch: 0.06, fuzz: true }, Bleached: { w: 0.07, arch: 0.05, pale: true } };

function browShapes(picks, p) {
  const detail = picks?.face_features || '';
  const spec = BROWS[picks?.brows] || { w: 0.065, arch: 0.05 };
  const colour = spec.pale ? '#e9e4cf' : darken(p.hairFill, 0.1);
  const y = EYE_Y - 0.3;
  const len = (detail === 'Tiny Brows' ? 0.13 : 0.26) * (spec.fuzz ? 1.15 : 1);
  if (detail === 'One Brow') return [{ key: 'brow-uni', tag: 'path', attrs: { d: `M${num(-0.62)} ${num(y)}Q0 ${num(y - 0.12)} ${num(0.62)} ${num(y)}`, strokeWidth: num(Math.max(0.1, spec.w * 1.2)), strokeLinecap: 'round' }, fill: 'none', stroke: colour }];
  return [-1, 1].map((dir) => ({ key: `brow-${dir}`, tag: 'path', attrs: { d: `M${num(dir * (EYE_GAP - len))} ${num(y + 0.03)}Q${num(dir * EYE_GAP)} ${num(y - spec.arch)} ${num(dir * (EYE_GAP + len))} ${num(y + 0.04)}`, strokeWidth: num(spec.w), strokeLinecap: 'round', ...(spec.fuzz ? { strokeDasharray: '0.05 0.03' } : {}) }, fill: 'none', stroke: colour }));
}

// ---- nose ----
const NOSES = { Straight: { w: 0.11, len: 0.3 }, Button: { w: 0.1, len: 0.24, round: true }, Aquiline: { w: 0.11, len: 0.34, hook: 0.09 }, Snub: { w: 0.11, len: 0.22, up: true }, Wide: { w: 0.2, len: 0.28 }, Narrow: { w: 0.06, len: 0.32 }, 'Round Tip': { w: 0.1, len: 0.28, round: true, tip: 0.07 } };

function noseShapes(picks, p) {
  const spec = NOSES[picks?.nose_shape] || { w: 0.11, len: 0.28 }, ink = darken(p.skin, 0.38), top = -0.02, base = top + spec.len;
  const out = [{ key: 'nose-bridge', tag: 'path', attrs: { d: `M${num(-0.03)} ${top}Q${num(-spec.w - (spec.hook || 0))} ${num(top + spec.len * 0.55)} ${num(-spec.w)} ${num(base)}M${num(0.03)} ${top}Q${num(spec.w + (spec.hook || 0))} ${num(top + spec.len * 0.55)} ${num(spec.w)} ${num(base)}`, strokeWidth: 0.04, strokeLinecap: 'round' }, fill: 'none', stroke: ink }];
  out.push({ key: 'nose-base', tag: 'path', attrs: { d: `M${num(-spec.w)} ${num(base)}Q0 ${num(base + (spec.up ? -0.04 : 0.07))} ${num(spec.w)} ${num(base)}`, strokeWidth: 0.04, strokeLinecap: 'round' }, fill: 'none', stroke: ink });
  for (const dir of [-1, 1]) out.push({ key: `nostril-${dir}`, tag: 'ellipse', attrs: { cx: num(dir * spec.w * 0.55), cy: num(base - (spec.up ? 0.01 : 0.025)), rx: num(spec.w * (spec.up ? 0.4 : 0.3)), ry: spec.up ? 0.045 : 0.025 }, fill: ink });
  if (spec.round) out.push({ key: 'nose-tip', tag: 'circle', attrs: { cx: 0, cy: num(base - 0.03), r: num(0.075 + (spec.tip || 0)) }, fill: lighten(p.skin, 0.12), opacity: 0.8 });
  return out;
}

// ---- cheeks ----
function cheekShapes(picks, p) {
  const kind = picks?.cheeks || '', shade = darken(p.skin, 0.22), out = [];
  if (kind === 'High Cheekbones') for (const dir of [-1, 1]) out.push({ key: `cheek-${dir}`, tag: 'path', attrs: { d: `M${num(dir * 0.9)} ${num(0.0)}L${num(dir * 0.5)} ${num(0.32)}L${num(dir * 0.82)} ${num(0.42)}Z` }, fill: shade, opacity: 0.55 });
  if (kind === 'Full Cheeks') for (const dir of [-1, 1]) out.push({ key: `cheek-${dir}`, tag: 'circle', attrs: { cx: num(dir * 0.62), cy: 0.34, r: 0.25 }, fill: lighten(p.skin, 0.16), opacity: 0.8 });
  if (kind === 'Dimples') for (const dir of [-1, 1]) out.push({ key: `cheek-${dir}`, tag: 'path', attrs: { d: `M${num(dir * 0.48)} ${num(0.42)}q${num(dir * 0.04)} 0.07 0 0.14`, strokeWidth: 0.04, strokeLinecap: 'round' }, fill: 'none', stroke: darken(p.skin, 0.4) });
  if (kind === 'Hollow Cheeks') for (const dir of [-1, 1]) out.push({ key: `cheek-${dir}`, tag: 'path', attrs: { d: `M${num(dir * 0.78)} ${num(0.12)}Q${num(dir * 0.44)} ${num(0.34)} ${num(dir * 0.66)} ${num(0.66)}Q${num(dir * 0.6)} 0.34 ${num(dir * 0.78)} ${num(0.12)}Z` }, fill: darken(p.skin, 0.4), opacity: 0.45 });
  return out;
}

// ---- mouth, lips and teeth ----
const LIPS = { Full: { t: 0.1, colour: '#b9505a' }, Thin: { t: 0.03, colour: '#a8605f' }, 'Cupid Bow': { t: 0.07, colour: '#c05a68', bow: true }, Glossy: { t: 0.08, colour: '#d2566b', gloss: true }, 'Matte Dark': { t: 0.08, colour: '#4a2133' } };
const MOUTHS = {
  'Small Mouth': { w: 0.13 }, 'Large Mouth': { w: 0.42 }, 'No Teeth': { w: 0.25 }, 'Unique Teeth': { w: 0.27, open: 0.1, teeth: [0.08, 0.14, 0.06, 0.12] }, 'Gap Teeth': { w: 0.27, open: 0.1, teeth: [0.1, 0.1, 0, 0.1, 0.1] },
  'Crooked Teeth': { w: 0.27, open: 0.1, teeth: [0.1, 0.1, 0.1, 0.1], crooked: true }, 'Gold Tooth': { w: 0.27, open: 0.1, teeth: [0.1, 0.1, 0.1, 0.1], gold: 2 }, 'Bright Smile': { w: 0.4, open: 0.16, teeth: [0.1, 0.1, 0.1, 0.1, 0.1, 0.1] },
  'Sharp Teeth': { w: 0.3, open: 0.12, teeth: [0.1, 0.1, 0.1, 0.1], sharp: true }, 'Forked Tongue': { w: 0.25, open: 0.1, tongue: 1 }, 'Two Tongues': { w: 0.28, open: 0.1, tongue: 2 },
};
const MOUTH_Y = 0.55;

function mouthShapes(picks, p) {
  const spec = MOUTHS[picks?.mouth] || { w: 0.25 }, lip = LIPS[picks?.lips] || { t: 0.05, colour: '#a85a5a' };
  const w = spec.w * p.mouthScale, open = spec.open || 0, out = [];
  if (open) out.push({ key: 'mouth-open', tag: 'path', attrs: { d: `M${num(-w)} ${MOUTH_Y}Q0 ${num(MOUTH_Y + open * 2.6)} ${num(w)} ${MOUTH_Y}Q0 ${num(MOUTH_Y - 0.03)} ${num(-w)} ${MOUTH_Y}Z` }, fill: '#3a1518' });
  if (spec.teeth) {
    const n = spec.teeth.length, step = (2 * w * 0.82) / n;
    spec.teeth.forEach((h, i) => {
      if (!h) return;
      const x = -w * 0.82 + step * (i + 0.5), top = MOUTH_Y + 0.005, tilt = spec.crooked ? (i % 2 ? 9 : -8) : 0;
      out.push({ key: `tooth-${i}`, tag: 'path', attrs: { d: spec.sharp ? `M${num(x - step / 2)} ${top}L${num(x)} ${num(top + h * 1.6)}L${num(x + step / 2)} ${top}Z` : `M${num(x - step * 0.45)} ${top}h${num(step * 0.9)}v${num(h)}h${num(-step * 0.9)}Z`, transform: `rotate(${tilt} ${num(x)} ${top})` }, fill: spec.gold === i ? '#e0b93c' : '#f6f2e8' });
    });
  }
  for (let t = 0; t < (spec.tongue || 0); t++) {
    const x = spec.tongue === 2 ? (t ? 0.07 : -0.07) : 0;
    out.push({ key: `tongue-${t}`, tag: 'path', attrs: { d: `M${num(x - 0.045)} ${num(MOUTH_Y + 0.02)}L${num(x - 0.045)} ${num(MOUTH_Y + 0.2)}L${num(x)} ${num(MOUTH_Y + 0.16)}L${num(x + 0.045)} ${num(MOUTH_Y + 0.21)}L${num(x + 0.045)} ${num(MOUTH_Y + 0.02)}Z` }, fill: '#c0405c' });
  }
  // Lips frame the opening, or are the whole mouth when it is closed.
  const smile = open ? 0.02 : 0.05;
  out.push({ key: 'mouth', tag: 'path', attrs: { d: `M${num(-w)} ${MOUTH_Y}Q0 ${num(MOUTH_Y + smile + lip.t * 0.6)} ${num(w)} ${MOUTH_Y}${lip.bow ? `Q${num(w * 0.35)} ${num(MOUTH_Y - lip.t)} 0 ${num(MOUTH_Y - lip.t * 0.4)}Q${num(-w * 0.35)} ${num(MOUTH_Y - lip.t)} ${num(-w)} ${MOUTH_Y}` : ''}`, strokeWidth: num(0.03 + lip.t), strokeLinecap: 'round', strokeLinejoin: 'round' }, fill: 'none', stroke: lip.colour });
  if (lip.gloss) out.push({ key: 'lip-gloss', tag: 'path', attrs: { d: `M${num(-w * 0.4)} ${num(MOUTH_Y + 0.06)}q${num(w * 0.4)} 0.03 ${num(w * 0.8)} 0`, strokeWidth: 0.03, strokeLinecap: 'round' }, fill: 'none', stroke: '#ffffff', opacity: 0.75 });
  return out;
}

// ---- ears, horns ----
function earShapes(picks, p) {
  const kind = picks?.ears || 'Human', inner = darken(p.skin, 0.2), out = [];
  const ear = { Human: (dir) => ({ tag: 'ellipse', attrs: { cx: dir * 0.97, cy: 0.05, rx: 0.13, ry: 0.22 } }), 'Elf Ears': (dir) => ({ tag: 'path', attrs: { d: `M${dir * 0.93} -0.12L${dir * 1.55} -0.5L${dir * 0.95} 0.28Z` } }), 'Wing Ears': (dir) => ({ tag: 'path', attrs: { d: `M${dir * 0.93} -0.05Q${dir * 1.5} -0.7 ${dir * 1.7} -0.2Q${dir * 1.45} 0.1 ${dir * 1.5} 0.4Q${dir * 1.1} 0.25 ${dir * 0.93} 0.3Z` } }) }[kind];
  if (!ear) return out;
  for (const dir of [-1, 1]) { const { tag, attrs } = ear(dir); out.push({ key: `ear-${dir}`, tag, attrs, fill: p.skin, stroke: inner, strokeWidth: 0.03 }); }
  return out;
}
const HORN_COLOUR = '#e6dcc0';
const HORNS = {
  'Small Horns': (dir) => ({ d: `M${dir * 0.42} -0.9L${dir * 0.5} -1.32L${dir * 0.62} -0.82Z`, fill: HORN_COLOUR }),
  'Big Horns': (dir) => ({ d: `M${dir * 0.4} -0.9Q${dir * 0.95} -1.2 ${dir * 0.7} -1.85Q${dir * 1.2} -1.35 ${dir * 0.72} -0.82Z`, fill: HORN_COLOUR }),
  Antlers: (dir) => ({ d: `M${dir * 0.45} -0.9L${dir * 0.7} -1.6M${dir * 0.58} -1.28L${dir * 0.95} -1.35M${dir * 0.66} -1.5L${dir * 0.5} -1.9`, stroke: '#8a6a46' }),
};
function hornShapes(picks) {
  const make = HORNS[picks?.horns];
  return make ? [-1, 1].map((dir) => { const { d, fill, stroke } = make(dir); return { key: `horn-${dir}`, tag: 'path', attrs: { d, ...(stroke ? { strokeWidth: 0.07, strokeLinecap: 'round' } : {}) }, fill: fill || 'none', stroke }; }) : [];
}

// ---- facial hair, on the lower face and over the lips ----
const BEARD = {
  'Clean Shaven': () => null,
  Stubble: () => ({ dots: true }),
  'Full Beard': (jw) => ({ d: `M${-jw} 0.05Q${-jw * 1.02} 0.75 0 1.1Q${jw * 1.02} 0.75 ${jw} 0.05Q${jw * 0.6} 0.4 ${jw * 0.45} 0.5Q0 0.4 ${-jw * 0.45} 0.5Q${-jw * 0.6} 0.4 ${-jw} 0.05Z` }),
  Goatee: () => ({ d: 'M-0.2 0.7Q0 0.58 0.2 0.7Q0.18 1.1 0 1.12Q-0.18 1.1 -0.2 0.7Z' }),
  'Pencil Moustache': () => ({ d: 'M-0.3 0.42Q0 0.36 0.3 0.42', stroke: true, width: 0.04 }),
  'Giant Moustache': () => ({ d: 'M-0.9 0.5Q-0.55 0.22 0 0.38Q0.55 0.22 0.9 0.5Q0.6 0.62 0.3 0.46Q0 0.5 -0.3 0.46Q-0.6 0.62 -0.9 0.5Z' }),
  'Forked Beard': () => ({ d: 'M-0.34 0.7Q-0.5 1.15 -0.32 1.55Q-0.12 1.2 0 0.98Q0.12 1.2 0.32 1.55Q0.5 1.15 0.34 0.7Q0 0.82 -0.34 0.7Z' }),
  'Beard Cube': () => ({ d: 'M-0.5 0.65H0.5V1.35H-0.5Z' }),
  'Single Chin Curl': () => ({ d: 'M0 0.95Q0.3 1.2 0.12 1.5Q-0.12 1.45 0.05 1.28', stroke: true, width: 0.06 }),
};
function facialHairShapes(picks, p, head) {
  const make = BEARD[picks?.facial_hair];
  if (!make) return [];
  const spec = make(head.jawWidth), colour = darken(p.hairFill, 0.05);
  if (!spec) return [];
  if (spec.dots) return Array.from({ length: 26 }, (_, i) => ({ key: `stubble-${i}`, tag: 'circle', attrs: { cx: num(((i * 37) % 17 - 8) * 0.085), cy: num(0.5 + ((i * 53) % 11) * 0.055), r: 0.028 }, fill: darken(p.hairFill, 0.1), opacity: 0.8 }));
  return [{ key: 'facial-hair', tag: 'path', attrs: { d: spec.d, ...(spec.stroke ? { strokeWidth: spec.width, strokeLinecap: 'round' } : {}) }, fill: spec.stroke ? 'none' : colour, stroke: spec.stroke ? colour : undefined }];
}

// ---- small face details ----
function detailShapes(picks, p) {
  const detail = picks?.face_features || '', out = [];
  if (detail === 'Huge Lashes') for (const dir of [-1, 1]) for (let i = 0; i < 4; i++) out.push({ key: `lash-${dir}-${i}`, tag: 'path', attrs: { d: `M${num(dir * (EYE_GAP - 0.17 + i * 0.12))} ${num(EYE_Y - 0.1)}l${num(dir * 0.04 - dir * i * 0.012)} -0.17`, strokeWidth: 0.035, strokeLinecap: 'round' }, fill: 'none', stroke: '#17171a' });
  if (detail === 'Glossy Cheeks' || detail === 'Painted Blush') for (const dir of [-1, 1]) out.push({ key: `blush-${dir}`, tag: 'ellipse', attrs: { cx: num(dir * 0.6), cy: 0.3, rx: 0.2, ry: 0.12 }, fill: detail === 'Painted Blush' ? '#e9798f' : '#ffffff', opacity: detail === 'Painted Blush' ? 0.6 : 0.4 });
  if (detail === 'Metallic Freckles') for (let i = 0; i < 9; i++) out.push({ key: `freckle-${i}`, tag: 'circle', attrs: { cx: num(((i % 3) - 1) * 0.16 + (i < 5 ? -0.55 : 0.55) * 1), cy: num(0.14 + Math.floor(i / 3) * 0.07), r: 0.03 }, fill: '#d9d4c0' });
  if (detail === 'Beauty Mark Constellation') [[-0.62, 0.2], [-0.42, 0.34], [-0.7, 0.42], [-0.5, 0.52]].forEach(([x, y], i, all) => { out.push({ key: `star-${i}`, tag: 'circle', attrs: { cx: x, cy: y, r: 0.03 }, fill: '#2a1d22' }); if (i) out.push({ key: `star-line-${i}`, tag: 'path', attrs: { d: `M${all[i - 1][0]} ${all[i - 1][1]}L${x} ${y}`, strokeWidth: 0.012 }, fill: 'none', stroke: '#2a1d22' }); });
  return out;
}

function glassesShapes(picks) {
  const kind = ['Glasses', 'Round Glasses', 'Sunglasses'].includes(picks?.everyday_accessories) ? picks.everyday_accessories : '';
  if (!kind) return [];
  const r = kind === 'Glasses' ? 0.3 : 0.32;
  const frames = [-1, 1].map((dir) => ({ key: `glass-${dir}`, tag: kind === 'Glasses' ? 'rect' : 'circle', attrs: kind === 'Glasses' ? { x: num(dir * EYE_GAP - 0.3), y: num(EYE_Y - 0.2), width: 0.6, height: 0.4, rx: 0.08, strokeWidth: 0.05 } : { cx: num(dir * EYE_GAP), cy: EYE_Y, r, strokeWidth: 0.05 }, fill: kind === 'Sunglasses' ? '#1c1c20' : 'none', stroke: '#1c1c20' }));
  return [...frames, { key: 'glass-bridge', tag: 'path', attrs: { d: `M${num(-EYE_GAP + 0.3)} ${EYE_Y}Q0 ${EYE_Y - 0.1} ${num(EYE_GAP - 0.3)} ${EYE_Y}`, strokeWidth: 0.04 }, fill: 'none', stroke: '#1c1c20' }];
}

/** Everything on the face, in drawing order, in unit space. `p`: { skin, hairFill, eyeFill, eyeScale, mouthScale }. */
export function faceShapes(picks, p) {
  const head = headOutline(picks?.head_shape, picks?.chin_jaw);
  const out = [];
  out.push(...hornShapes(picks), ...earShapes(picks, p));
  out.push({ key: 'head', tag: 'path', attrs: { d: head.d }, fill: p.skin });
  if (head.cleft) out.push({ key: 'cleft', tag: 'path', attrs: { d: `M0 ${num(head.chinY - 0.22)}v0.12`, strokeWidth: 0.035, strokeLinecap: 'round' }, fill: 'none', stroke: darken(p.skin, 0.4) });
  out.push(...cheekShapes(picks, p), ...eyeShapes(picks, p), ...browShapes(picks, p), ...noseShapes(picks, p), ...mouthShapes(picks, p), ...detailShapes(picks, p), ...facialHairShapes(picks, p, head), ...glassesShapes(picks));
  return { scale: head.scale, shapes: out };
}

/** The option lists the face can draw, so tests can pin that every option of every face group has its own entry. */
export const FACE_TABLES = Object.freeze({
  head_shape: Object.keys(HEAD_BASE), chin_jaw: Object.keys(JAW), eye_shape: Object.keys(EYE_SHAPES), eyes_type: Object.keys(EYE_TYPES), brows: Object.keys(BROWS),
  nose_shape: Object.keys(NOSES), lips: Object.keys(LIPS), mouth: Object.keys(MOUTHS), horns: Object.keys(HORNS), facial_hair: Object.keys(BEARD),
});
