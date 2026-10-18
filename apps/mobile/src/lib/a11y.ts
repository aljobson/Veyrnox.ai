// Accessibility helpers shared by the screens.

// Apple and Android both ask for touch targets of at least 44 points.
export const MIN_TARGET = 44;

// Spread into a style to give a small, text-only control a 44 pt tall target without changing how it looks.
export const touchTarget = { minHeight: MIN_TARGET, justifyContent: 'center' } as const;

export const selectedState = (selected: boolean) => ({ selected }) as const;

// Padding to add around a view of the given size so its touch area reaches the minimum.
export function hitSlopFor(width: number, height: number) {
    const x = Math.max(0, Math.ceil((MIN_TARGET - width) / 2));
    const y = Math.max(0, Math.ceil((MIN_TARGET - height) / 2));
    return { top: y, bottom: y, left: x, right: x };
}
