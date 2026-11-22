import { useRef, type ReactNode, type ComponentRef } from 'react';
import { AccessibilityInfo, findNodeHandle, Modal, ScrollView, View } from 'react-native';
import { Text, themedStyles, useThemedStyles } from '../ui';
import { ds } from '../../theme';
export function BeatModal({ title, testID, onClose, onDismiss, children }: { title: string; testID?: string; onClose(): void; onDismiss?(): void; children: ReactNode }) {
    const heading = useRef<ComponentRef<typeof View>>(null);
    const s = useThemedStyles(sheets);
    return <Modal testID={testID} visible animationType="none" onRequestClose={onClose} onDismiss={onDismiss} onShow={() => {
        const node = findNodeHandle(heading.current); if (node) AccessibilityInfo.setAccessibilityFocus(node);
    }}>
        <ScrollView style={s.screen} contentContainerStyle={s.content} accessibilityViewIsModal>
            <View ref={heading} accessible accessibilityRole="header" accessibilityLabel={title}><Text variant="title2">{title}</Text></View>
            {children}
        </ScrollView>
    </Modal>;
}
const sheets = themedStyles(p => ({ screen: { flex: 1, backgroundColor: p.bg }, content: { padding: ds.space.gutter, paddingTop: ds.space.hero, gap: ds.space.lg } }));
