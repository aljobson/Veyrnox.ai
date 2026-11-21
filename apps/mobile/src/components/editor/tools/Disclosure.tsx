import { useState, type ReactNode } from 'react';
import { Pressable, Text, View } from 'react-native';
import { ds } from '../../../theme';
import { rawText } from '../../../lib/i18n';
import { touchTarget } from '../../../lib/a11y';
import { styles } from '../fullEditorStyles';
export function Disclosure({ title, children }: { title: string; children: ReactNode }) {
    const [expanded, setExpanded] = useState(false);
    return <View style={{ gap: ds.space.sm }}>
        <Pressable accessibilityRole="button" accessibilityLabel={rawText(title)} accessibilityState={{ expanded }}
            style={[styles.panelHeading, touchTarget]} onPress={() => setExpanded(value => !value)}>
            <Text accessibilityRole="header" style={styles.sectionTitle}>{title}</Text>
        </Pressable>
        {expanded ? <View style={{ gap: ds.space.sm }}>{children}</View> : null}
    </View>;
}
