export function seededRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let value = Math.imul(state ^ (state >>> 15), 1 | state);
    value ^= value + Math.imul(value ^ (value >>> 7), 61 | value);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}
export function exportSeed(doc) {
  let hash = 0x811c9dc5;
  for (const byte of new TextEncoder().encode(doc.id)) hash = Math.imul(hash ^ byte, 0x01000193);
  return hash >>> 0;
}
