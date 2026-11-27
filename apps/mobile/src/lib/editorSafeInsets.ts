export function editorTopInset(platform: string, measuredTop: number | null | undefined, windowHeight: number) {
    const measured = Number.isFinite(measuredTop) ? Math.max(0, Number(measuredTop)) : 0;
    if (measured > 0 || platform !== 'ios') return measured;

    // The editor is presented through a native full-screen route. During the
    // first frame on iOS, safe-area-context can report zero even on notched
    // devices. Keep the project controls below the status bar until the native
    // inset arrives instead of placing Back/Save/Export underneath it.
    return windowHeight >= 800 ? 54 : 20;
}
