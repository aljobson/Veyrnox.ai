import { useRef, type ReactNode, type ComponentRef } from 'react';
import { AccessibilityInfo, findNodeHandle, KeyboardAvoidingView, Modal, Platform, Pressable, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Text, themedStyles, useThemedStyles } from '../ui';
import { ds } from '../../theme';
import { KeyboardFormScrollView } from '../KeyboardFormScrollView';
export function BeatModal({ title, testID, onClose, onDismiss, scrollable = true, children }: {
    title: string; testID?: string; onClose(): void; onDismiss?(): void; scrollable?: boolean; children: ReactNode;
}) {
    const heading = useRef<ComponentRef<typeof View>>(null);
    const s = useThemedStyles(sheets);
    return <Modal testID={testID} visible transparent animationType="slide" presentationStyle="overFullScreen"
        statusBarTranslucent onRequestClose={onClose} onDismiss={onDismiss} onShow={() => {
        const node = findNodeHandle(heading.current); if (node) AccessibilityInfo.setAccessibilityFocus(node);
    }}>
        <View style={s.overlay}>
        <Pressable accessibilityElementsHidden importantForAccessibility="no-hide-descendants"
            accessibilityLabel="" onPress={onClose} style={StyleSheet.absoluteFill} />
        <SafeAreaView testID={testID ? `${testID}-bottom-sheet` : 'beat-bottom-sheet'} edges={['right', 'bottom', 'left']}
            style={[s.sheet, !scrollable && s.fixedSheet]} accessibilityViewIsModal onAccessibilityEscape={onClose}>
        <View style={s.handle} accessibilityElementsHidden />
        {scrollable ? <KeyboardAvoidingView style={s.keyboard} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
            <KeyboardFormScrollView style={s.scroller} contentContainerStyle={s.content} keyboardShouldPersistTaps="handled">
            <View ref={heading} accessible accessibilityRole="header" accessibilityLabel={title}><Text variant="title2">{title}</Text></View>
            {children}
        </KeyboardFormScrollView></KeyboardAvoidingView> : <View style={[s.content, s.fixed]}>
            <View ref={heading} accessible accessibilityRole="header" accessibilityLabel={title}><Text variant="title2">{title}</Text></View>
            {children}
        </View>}
        </SafeAreaView>
        </View>
    </Modal>;
}
const sheets = themedStyles(p => ({
    overlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.42)' },
    sheet: { width: '100%', maxHeight: '82%', minHeight: 180, overflow: 'hidden', borderTopLeftRadius: ds.radius.xl,
        borderTopRightRadius: ds.radius.xl, borderWidth: 1, borderBottomWidth: 0, borderColor: p.borderStrong, backgroundColor: p.bgElevated1 },
    fixedSheet: { height: '82%' },
    keyboard: { flexShrink: 1 },
    scroller: { flexGrow: 0 },
    handle: { width: 36, height: 4, alignSelf: 'center', marginTop: ds.space.sm, borderRadius: ds.radius.pill, backgroundColor: p.borderStrong },
    content: { padding: ds.space.gutter, paddingTop: ds.space.md, paddingBottom: ds.space.xxl, gap: ds.space.lg },
    fixed: { flex: 1 },
}));
