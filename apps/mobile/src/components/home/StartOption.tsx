import { rawText } from '../../lib/i18n/translate';
import { type Href, useRouter } from 'expo-router';
import type { MenuIcon } from '../../lib/menuIcons';
import { vividFromFeatureHue, type FeatureHue } from '../../theme';
import { VividCard } from '../ui';

export function StartOption({ href, icon, hue, title, body, hint, divided = false, badge, style, onPress }: { href: Href; onPress?: () => void; icon: MenuIcon; hue: FeatureHue; title: string; body: string; hint: string; divided?: boolean; badge?: string; style: { minHeight: number } }) {
    const router = useRouter();
    return <VividCard
        hue={vividFromFeatureHue(hue)}
        icon={icon}
        title={title}
        detail={body}
        eyebrow={badge}
        layout="row"
        showChevron
        accessibilityLabel={rawText(title)}
        accessibilityHint={rawText(hint)}
        style={[style, divided ? { marginTop: 0 } : undefined]}
        onPress={() => { onPress?.(); router.push(href); }}
    />;
}
