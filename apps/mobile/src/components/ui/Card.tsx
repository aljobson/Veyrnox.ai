import { View, StyleSheet, type ViewProps } from 'react-native';
import { ds } from '../../theme';
import { themedStyles, useThemedStyles } from './AppearanceContext';
export function Card({ style, selected, ...props }: ViewProps & { selected?: boolean }) {
    const s = useThemedStyles(sheets);
    return <View {...props} style={[s.card, selected && s.selected, style]} />;
}
const sheets = themedStyles((p, _, scheme) => ({
    card: {
        backgroundColor: p.bgElevated1,
        borderRadius: ds.radius.lg,
        padding: ds.space.lg,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: p.borderSubtle,
        boxShadow: ds.elevation[scheme].e1,
    },
    selected: { borderWidth: 2, borderColor: p.accent, backgroundColor: p.accentSubtle },
}));
