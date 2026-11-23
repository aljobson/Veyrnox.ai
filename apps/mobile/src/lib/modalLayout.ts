export type ScreenInsets = { top: number; right: number; bottom: number; left: number };

/** Physical safe-edge padding for custom modal surfaces. Keeps landscape camera and home-indicator areas clear. */
export function modalSafePadding(insets: ScreenInsets, gutter = 16) {
    return {
        paddingTop: Math.max(gutter, insets.top + gutter),
        paddingRight: Math.max(gutter, insets.right + gutter),
        paddingBottom: Math.max(gutter, insets.bottom + gutter),
        paddingLeft: Math.max(gutter, insets.left + gutter),
    };
}

/** A bottom sheet already sits below the status bar, so only its physical sides and bottom consume safe insets. */
export function bottomSheetSafePadding(insets: ScreenInsets, gutter = 16, topPadding = gutter, bottomPadding = topPadding) {
    return {
        paddingTop: topPadding,
        paddingRight: insets.right + gutter,
        paddingBottom: Math.max(bottomPadding, insets.bottom + gutter),
        paddingLeft: insets.left + gutter,
    };
}

export function readableWidth(width: number, insets: Pick<ScreenInsets, 'left' | 'right'>, maximum: number) {
    return Math.max(0, Math.min(maximum, width - insets.left - insets.right));
}
