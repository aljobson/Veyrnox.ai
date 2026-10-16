import { clampVeyPosition, VEY_SIZE } from './veyPointer.js';

export function overlapArea(position, rect, gap = 6) {
  return Math.max(0, Math.min(position.x + VEY_SIZE.width + gap, rect.right) - Math.max(position.x - gap, rect.left))
    * Math.max(0, Math.min(position.y + VEY_SIZE.height + gap, rect.bottom) - Math.max(position.y - gap, rect.top));
}

// Manual placement is a preference, not permission to cover a control.
export function safeMobilePosition(preferred, viewport, obstacles) {
  const start = clampVeyPosition(preferred, viewport);
  if (viewport.width >= 640 || !obstacles.some(rect => overlapArea(start, rect))) return start;
  const candidates = [start];
  for (let y = 72; y <= viewport.height - VEY_SIZE.height - 8; y += 24) {
    for (let x = 8; x <= viewport.width - VEY_SIZE.width - 8; x += 24) candidates.push({ x, y });
  }
  for (const r of obstacles) {
    for (const x of [r.left - VEY_SIZE.width - 6, r.right + 6]) {
      for (const y of [r.top - VEY_SIZE.height - 6, r.bottom + 6, start.y]) candidates.push(clampVeyPosition({ x, y }, viewport));
    }
  }
  const score = p => obstacles.reduce((sum, r) => sum + overlapArea(p, r), 0) * 100000
    + Math.hypot(p.x - start.x, p.y - start.y);
  return candidates.reduce((best, candidate) => score(candidate) < score(best) ? candidate : best, start);
}

export function mobileClearance(base, viewport, panel) {
  return panel && viewport.width < 640 ? Math.max(base, viewport.height - panel.top + VEY_SIZE.height + 24) : base;
}
