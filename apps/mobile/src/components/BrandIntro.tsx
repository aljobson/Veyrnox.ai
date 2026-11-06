import { paletteForScheme } from '../theme';
import { useAppearance } from './ui';
import { MascotWordmark } from './MascotWordmark';

// The Veyrnox.ai lockup where Vey runs across the letters and lands as the dot of the i. It follows the live appearance,
// so a dark/light switch while the screen is open does not leave a light wordmark on a light background.
export function BrandIntro({ fontSize = 36, onDone }: { fontSize?: number; onDone?: () => void }) {
    const { settings, scheme } = useAppearance();
    return <MascotWordmark fontSize={fontSize} palette={paletteForScheme(scheme, settings)} onDone={onDone} />;
}
