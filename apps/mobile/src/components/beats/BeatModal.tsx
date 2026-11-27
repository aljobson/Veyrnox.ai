import { useRef, type ReactNode, type ComponentRef } from 'react';
import { AccessibilityInfo, findNodeHandle, KeyboardAvoidingView, Modal, Platform, Pressable, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button, Text, themedStyles, useThemedStyles } from '../ui';
import { ds } from '../../theme';
import { KeyboardFormScrollView } from '../KeyboardFormScrollView';
export function BeatModal({ title, testID, onClose, onDismiss, scrollable = true, closeLabel, children }: {
    title: string; testID?: string; onClose(): void; onDismiss?(): void; scrollable?: boolean; closeLabel?: string; children: ReactNode;
}) {
    const heading = useRef<ComponentRef<typeof View>>(null);
    const s = useThemedStyles(sheets);
    const header = <View style={s.header}>
        <View ref={heading} accessible accessibilityRole="header" accessibilityLabel={title} style={s.heading}>
            <Text variant="title2" numberOfLines={1}>{title}</Text>
        </View>
        {closeLabel ? <Button testID={testID ? `${testID}-close` : undefined} size="md" variant="tertiary"
            icon="close" iconOnly label={closeLabel} onPress={onClose} containerStyle={s.close} /> : null}
    </View>;
    return <Modal testID={testID} visible transparent animationType="slide" presentationStyle="overFullScreen"
        statusBarTranslucent onRequestClose={onClose} onDismiss={onDismiss} onShow={() => {
        const node = findNodeHandle(heading.current); if (node) AccessibilityInfo.setAccessibilityFocus(node);
    }}>
        <View style={s.overlay}>
        <Pressable accessibilityRole="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants"
            accessibilityLabel="" onPress={onClose} style={StyleSheet.absoluteFill} />
        <SafeAreaView testID={testID ? `${testID}-bottom-sheet` : 'beat-bottom-sheet'} edges={['right', 'bottom', 'left']}
            style={[s.sheet, !scrollable && s.fixedSheet]} accessibilityViewIsModal onAccessibilityEscape={onClose}>
        <View style={s.handle} accessibilityElementsHidden />
        {scrollable ? <KeyboardAvoidingView style={s.keyboard} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
            <KeyboardFormScrollView style={s.scroller} contentContainerStyle={s.content} keyboardShouldPersistTaps="handled">
            {header}
            {children}
        </KeyboardFormScrollView></KeyboardAvoidingView> : <View style={[s.content, s.fixed]}>
            {header}
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
    header: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: ds.space.sm },
    heading: { flex: 1, minWidth: 0 },
    close: { flexShrink: 0 },
}));
