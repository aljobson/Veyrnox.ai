// CanvasKit sRGB RGBA8/Unpremul, 128x128, idle, seed 0.5, 30 steps of 1/30s.
// PNGs visually inspected on 2026-11-20: blue Volt, orange Ember, pink/red Berry.
// Regression baseline, NOT an independent WebGL parity reference. ±2 byte tolerance.
export const WOBNIMO_COLOR_POINTS = [[64, 64], [50, 75], [75, 85]] as const;
export const WOBNIMO_COLOR_GOLDENS = {
    volt: [[23, 26, 35, 255], [20, 37, 116, 255], [91, 134, 220, 255]],
    ember: [[173, 166, 158, 255], [233, 170, 79, 255], [215, 202, 193, 255]],
    berry: [[223, 55, 92, 255], [218, 103, 131, 255], [198, 152, 80, 255]],
} as const;
