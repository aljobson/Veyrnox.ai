export const TAB_HEADER_WORDMARK_MIN_WIDTH = 390;
export const TAB_HEADER_WORDMARK_MAX_FONT_SCALE = 1.3;

/** Compact or large-text headers keep the accessible V mark but omit the fixed visual wordmark. */
export const tabHeaderShowsWordmark = (width: number, fontScale = 1): boolean =>
    width >= TAB_HEADER_WORDMARK_MIN_WIDTH && fontScale <= TAB_HEADER_WORDMARK_MAX_FONT_SCALE;
