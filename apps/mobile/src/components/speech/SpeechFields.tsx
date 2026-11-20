import { View } from 'react-native';
import { Text, Icon } from '../ui';
import type { MenuIcon } from '../../lib/menuIcons';
export function SpeechLabel({ icon, label }: { icon: MenuIcon; label: string }) {
    return <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}><Icon name={icon} /><Text variant="title3" accessibilityRole="header" style={{ flex: 1 }}>{label}</Text></View>;
}
export const speechLayout = { section: { gap: 12 }, chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 } } as const;
