// Colour helpers shared by the Oddling preview drawings (hex in, hex out).
const parse = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
export const mix = (hex, toward, amount) => {
  const a = parse(hex), b = parse(toward);
  return `#${a.map((v, i) => Math.round(v + (b[i] - v) * amount).toString(16).padStart(2, '0')).join('')}`;
};
export const darken = (hex, amount) => mix(hex, '#000000', amount);
export const lighten = (hex, amount) => mix(hex, '#ffffff', amount);
