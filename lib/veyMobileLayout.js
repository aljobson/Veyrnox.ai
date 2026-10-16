import { clampVeyPosition, VEY_SIZE } from './veyPointer.js';

// Only fixed helper geometry chooses the mobile dock: page scroll is irrelevant.
export function mobileDockPosition(viewport, panel, walkthrough = false) {
  if (!panel) return clampVeyPosition({ x: 8, y: viewport.height - VEY_SIZE.height - 12 }, viewport);
  return clampVeyPosition(walkthrough
    ? { x: panel.right + 8, y: panel.top + 8 }
    : { x: panel.left + 12, y: panel.top - VEY_SIZE.height - 8 }, viewport);
}

export function mobileClearance(base, viewport, panel) {
  return viewport.width < 640 ? dockClearance(base, viewport, panel) : base;
}

export function dockClearance(base, viewport, panel) {
  return panel ? Math.max(base, viewport.height - panel.top + VEY_SIZE.height + 24) : base;
}
