import { vividFromFeatureHue, type FeatureHue } from '../../theme';
import type { MenuIcon } from '../../lib/menuIcons';
import { VividCard } from './VividCard';

export function ChoiceCard({ icon, title, detail, selected, hue, onPress }: { icon: MenuIcon; title: string; detail?: string; selected?: boolean; hue?: FeatureHue; onPress: () => void }) {
    return <VividCard hue={vividFromFeatureHue(hue ?? 'sky')} icon={icon} title={title} detail={detail} selected={selected} onPress={onPress} />;
}
