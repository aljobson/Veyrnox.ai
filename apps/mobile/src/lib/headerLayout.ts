export const TAB_HEADER_WORDMARK_MIN_WIDTH = 390;

/** Compact phones keep the accessible V mark but omit the fixed visual wordmark. */
export const tabHeaderShowsWordmark = (width: number): boolean => width >= TAB_HEADER_WORDMARK_MIN_WIDTH;
