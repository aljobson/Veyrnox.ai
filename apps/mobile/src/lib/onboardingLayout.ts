export type OnboardingChoiceLayout = 'tile' | 'row';

/** Two-column visual cards at standard sizes; a single readable column for narrow or AX layouts. */
export function onboardingChoiceLayout(width: number, fontScale: number, appScale = 1): OnboardingChoiceLayout {
    const effectiveTextScale = Math.max(1, fontScale) * Math.max(1, appScale);
    return width < 360 || effectiveTextScale >= 1.3 ? 'row' : 'tile';
}
