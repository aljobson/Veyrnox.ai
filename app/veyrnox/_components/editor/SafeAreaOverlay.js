import { safeAreaGuide, safeAreaPercentStyle } from '../../_lib/editorSafeAreas.mjs';

export function SafeAreaOverlay({ id, label, width, height }) {
    const guide = safeAreaGuide(id), style = safeAreaPercentStyle(id, width, height);
    if (!guide.insets || !style) return null;
    return <div data-testid={`editor-safe-area-${guide.id}`} aria-label={label} className="pointer-events-none absolute z-10 border border-dashed border-white/80 shadow-[0_0_0_9999px_rgba(0,0,0,0.22)]" style={style}>
        <span className="absolute start-1 top-1 rounded bg-black/75 px-1.5 py-0.5 text-[10px] font-bold text-white">{label}</span>
    </div>;
}
