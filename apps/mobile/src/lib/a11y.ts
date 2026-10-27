// Accessibility helpers shared by the screens.

// Apple and Android both ask for touch targets of at least 44 points.
export const MIN_TARGET = 44;

// Spread into a style to give a small, text-only control a 44 pt tall target without changing how it looks.
export const touchTarget = { minWidth: MIN_TARGET, minHeight: MIN_TARGET, justifyContent: 'center' } as const;

// ADR-0267: headings (including navigation) and body share a 1.5 system cap.
// With the same cap, every title stays larger than body at every accessibility size.
// In-app text size multiplies the whole ramp independently and preserves that ordering.
export const HEADING_MAX_FONT_SCALE = 1.5;
export const BODY_MAX_FONT_SCALE = 1.5;
// Fixed-height chrome (tab labels, header actions/chips and drawer headings).
// Page and navigation titles use HEADING_MAX_FONT_SCALE instead.
export const HEADER_MAX_FONT_SCALE = 1.3;
export const fontScaleCap = (variant: string) => variant === 'display' || variant.startsWith('title') ? HEADING_MAX_FONT_SCALE : BODY_MAX_FONT_SCALE;

export const selectedState = (selected: boolean) => ({ selected }) as const;

// Padding to add around a view of the given size so its touch area reaches the minimum.
export function hitSlopFor(width: number, height: number) {
    const x = Math.max(0, Math.ceil((MIN_TARGET - width) / 2));
    const y = Math.max(0, Math.ceil((MIN_TARGET - height) / 2));
    return { top: y, bottom: y, left: x, right: x };
}
