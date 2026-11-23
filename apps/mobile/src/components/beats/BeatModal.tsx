import { useRef, type ReactNode, type ComponentRef } from 'react';
import { AccessibilityInfo, findNodeHandle, Modal, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Text, themedStyles, useThemedStyles } from '../ui';
import { ds } from '../../theme';
import { KeyboardScreen } from '../KeyboardScreen';
import { KeyboardFormScrollView } from '../KeyboardFormScrollView';
export function BeatModal({ title, testID, onClose, onDismiss, scrollable = true, children }: {
    title: string; testID?: string; onClose(): void; onDismiss?(): void; scrollable?: boolean; children: ReactNode;
}) {
    const heading = useRef<ComponentRef<typeof View>>(null);
    const s = useThemedStyles(sheets);
    return <Modal testID={testID} visible animationType="none" onRequestClose={onClose} onDismiss={onDismiss} onShow={() => {
        const node = findNodeHandle(heading.current); if (node) AccessibilityInfo.setAccessibilityFocus(node);
    }}>
        <SafeAreaView edges={['top', 'right', 'bottom', 'left']} style={s.screen}>
        {scrollable ? <KeyboardScreen><KeyboardFormScrollView style={s.screen} contentContainerStyle={s.content} accessibilityViewIsModal onAccessibilityEscape={onClose} keyboardShouldPersistTaps="handled">
            <View ref={heading} accessible accessibilityRole="header" accessibilityLabel={title}><Text variant="title2">{title}</Text></View>
            {children}
        </KeyboardFormScrollView></KeyboardScreen> : <View style={[s.screen, s.content, s.fixed]} accessibilityViewIsModal onAccessibilityEscape={onClose}>
            <View ref={heading} accessible accessibilityRole="header" accessibilityLabel={title}><Text variant="title2">{title}</Text></View>
            {children}
        </View>}
        </SafeAreaView>
    </Modal>;
}
const sheets = themedStyles(p => ({
    screen: { flex: 1, backgroundColor: p.bg },
    content: { padding: ds.space.gutter, paddingTop: ds.space.hero, gap: ds.space.lg },
    fixed: { flex: 1 },
}));
