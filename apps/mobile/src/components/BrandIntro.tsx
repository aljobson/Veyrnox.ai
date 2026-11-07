import { paletteForScheme } from '../theme';
import { useAppearance } from './ui';
import type { Leap } from '../lib/splashLeap';
import { MascotWordmark, type WordmarkRest } from './MascotWordmark';

// The Veyrnox.ai lockup where Vey runs across the letters and lands as the dot of the i. It follows the live appearance,
// so a dark/light switch while the screen is open does not leave a light wordmark on a light background.
export function BrandIntro({ fontSize = 36, onDone, leap, onLeapDone, fadeOut }: {
    fontSize?: number; onDone?: (rest: WordmarkRest | null) => void; leap?: Leap | null; onLeapDone?: () => void; fadeOut?: boolean;
}) {
    const { settings, scheme } = useAppearance();
    return <MascotWordmark fontSize={fontSize} palette={paletteForScheme(scheme, settings)} onDone={onDone} leap={leap} onLeapDone={onLeapDone} fadeOut={fadeOut} />;
}
