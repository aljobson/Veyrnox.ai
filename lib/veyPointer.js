// SVG shoulder and viewport geometry share one contract with VeyCharacter.
export const VEY_SIZE = { width: 56, height: 58 };
export const VEY_SHOULDER = { x: 108, y: 85 };
const scale = VEY_SIZE.height / 170;
const inset = (VEY_SIZE.width - 160 * scale) / 2;
const clamp = (n, a, b) => Math.max(a, Math.min(b, n));

export function pointerPlacement(rect, viewport, obstacle = null) {
  const { width, height } = VEY_SIZE;
  const gap = 12;
  const candidates = [
    { x: rect.left - width - gap, y: rect.top + rect.height / 2 - height / 2, facing: 1 },
    { x: rect.right + gap, y: rect.top + rect.height / 2 - height / 2, facing: -1 },
    { x: rect.left + Math.min(rect.width / 2, width), y: rect.top - height - gap, facing: -1 },
    { x: rect.left + Math.min(rect.width / 2, width), y: rect.bottom + gap, facing: -1 },
  ];
  const overlap = (a, b) => b ? Math.max(0, Math.min(a.x + width, b.right) - Math.max(a.x, b.left)) * Math.max(0, Math.min(a.y + height, b.bottom) - Math.max(a.y, b.top)) : 0;
  const scored = candidates.map((candidate) => {
    const x = clamp(candidate.x, 8, viewport.width - width - 8);
    const y = clamp(candidate.y, 72, viewport.height - height - 8);
    const position = { x, y, facing: candidate.facing };
    return { ...position, score: overlap(position, rect) * 10 + overlap(position, obstacle) * 3 + Math.abs(x - candidate.x) + Math.abs(y - candidate.y) };
  });
  const position = scored.sort((a, b) => a.score - b.score)[0];
  const shoulderX = position.x + (position.facing === 1 ? inset + VEY_SHOULDER.x * scale : width - inset - VEY_SHOULDER.x * scale);
  const shoulderY = position.y + VEY_SHOULDER.y * scale;
  // Tiny controls use their centre; large controls use the nearest interior edge.
  const px = Math.min(12, rect.width / 2), py = Math.min(12, rect.height / 2);
  const vertical = position.y + height <= rect.top || position.y >= rect.bottom;
  const point = { x: clamp(shoulderX + (vertical ? position.facing * 60 : 0), rect.left + px, rect.right - px), y: clamp(shoulderY, rect.top + py, rect.bottom - py) };
  return { position: { x: position.x, y: position.y }, facing: position.facing, point,
    hand: { x: ((point.x - position.x) * position.facing + (position.facing === -1 ? width : 0) - inset) / scale,
      y: (point.y - position.y) / scale } };
}
