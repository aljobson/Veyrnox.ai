// Original Veyrnox preview guide. It is a conservative, grid-derived editing aid,
// not copied platform chrome or a promise about third-party UI placement.
export const SAFE_AREA_GUIDES = Object.freeze([
    Object.freeze({ id: 'off', labelKey: 'app.editor.safeArea.off', insets: null }),
    Object.freeze({ id: 'short-form', labelKey: 'app.editor.safeArea.shortForm', grid: Object.freeze({ columns: 20, rows: 20 }),
        insets: Object.freeze({ top: 2, right: 4, bottom: 4, left: 2 }),
        avoidZones: Object.freeze([
            Object.freeze({ id: 'actions', edge: 'right', thicknessUnits: 4, fromUnits: 3, toUnits: 16 }),
            Object.freeze({ id: 'caption-navigation', edge: 'bottom', thicknessUnits: 4, fromUnits: 0, toUnits: 20 }),
        ]) }),
]);
export const SAFE_AREA_GUIDE_IDS = Object.freeze(SAFE_AREA_GUIDES.map(guide => guide.id));
export function safeAreaGuide(id) { return SAFE_AREA_GUIDES.find(guide => guide.id === id) || SAFE_AREA_GUIDES[0]; }
export function contentGuideFor({ width, height, preset = 'short-form' }) {
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) throw new TypeError('positive preview dimensions required');
    const guide = safeAreaGuide(preset);
    if (!guide.insets || !guide.grid) return null;
    const normalized = Object.fromEntries(Object.entries(guide.insets).map(([edge, units]) => [edge, units / guide.grid[edge === 'left' || edge === 'right' ? 'columns' : 'rows']]));
    return Object.freeze({ id: guide.id, portrait: height > width, content: Object.freeze(normalized), avoidZones: guide.avoidZones });
}
export function safeAreaPercentStyle(id, width, height) {
    const guide = contentGuideFor({ width, height, preset: id });
    return guide?.portrait ? Object.fromEntries(Object.entries(guide.content).map(([key, value]) => [key, `${value * 100}%`])) : null;
}
