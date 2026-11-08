import { useReducedMotion } from '../ui/useReducedMotion';
import { useState } from 'react';
import { mobileEditorAction } from '../../lib/editorIntentRouter';
import { Text as UiText, TextField, Button as UiButton } from '../ui';
import { Modal, Pressable, ScrollView, KeyboardAvoidingView, Platform, StyleSheet, Text, View } from 'react-native';
import { touchTarget } from '../../lib/a11y';
import { rawText } from '../../lib/i18n/translate';
import { t } from '../../lib/i18n';
import { colors, fonts } from '../../theme';

export interface SheetRow { id: string; icon: string; label: string; hint?: string; disabled?: boolean; onPress(): void }
export type SimpleSheetName = 'add' | 'ai' | 'more';

// One bottom sheet for all three entries. Choosing a row closes the sheet first, then runs the action.
export function SimpleEditorSheet({ title, rows, onClose, describe = false, onDescribe }: { title: string; rows: readonly SheetRow[]; onClose(): void; describe?: boolean; onDescribe?(id: string, prompt: string): void }) {
    const reduced = useReducedMotion();
    const [prompt, setPrompt] = useState('');
    const [problem, setProblem] = useState('');
    function openDescribed() {
        const id = mobileEditorAction(prompt);
        const row = rows.find(item => item.id === id);
        if (!row || row.disabled) { setProblem(t('editorSimple.unsupported')); return; }
        onClose();
        if (onDescribe) onDescribe(row.id, prompt); else row.onPress();
    }
    return <Modal visible transparent animationType={reduced ? 'none' : 'slide'} onRequestClose={onClose} accessibilityViewIsModal>
        {/* Tap-outside dismissal only: the Close button below is the accessible control. */}
        <Pressable accessibilityRole="none" accessible={false} importantForAccessibility="no-hide-descendants" style={styles.backdrop} onPress={onClose} />
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ maxHeight: '85%' }}>
        <View style={[styles.sheet, { flexShrink: 1 }]}>
            <View style={styles.sheetHeader}>
                <Text accessibilityRole="header" style={styles.sheetTitle}>{title}</Text>
                <Pressable accessibilityRole="button" accessibilityLabel={rawText(t('editorSimple.close'))} onPress={onClose} style={[styles.closeButton, touchTarget]}><Text style={styles.closeText}>{t('editorSimple.close')}</Text></Pressable>
            </View>
            <ScrollView style={{ flexShrink: 1 }} keyboardShouldPersistTaps="handled" contentContainerStyle={{ gap: 8 }}>
            {describe ? <View style={{ gap: 8 }}>
                <TextField label={t('editorSimple.describe')} accessibilityLabel={rawText(t('editorSimple.describe'))} value={prompt} onChangeText={value => { setPrompt(value); setProblem(''); }} maxLength={500} onSubmitEditing={openDescribed} />
                <UiText variant="footnote">{t('editorSimple.promptHelp')}</UiText>
                {problem ? <UiText variant="footnote" accessibilityRole="alert" accessibilityLiveRegion="polite">{problem}</UiText> : null}
                <UiButton label={t('editorSimple.openTool')} accessibilityLabel={rawText(t('editorSimple.openTool'))} disabled={!prompt.trim()} onPress={openDescribed} />
            </View> : null}
            {rows.map((row) => <Pressable key={row.id} accessibilityRole="button" accessibilityLabel={rawText(row.label)} accessibilityState={{ disabled: !!row.disabled }} disabled={row.disabled} onPress={() => { onClose(); row.onPress(); }} style={({ pressed }) => [styles.row, row.disabled && styles.rowDisabled, pressed && styles.rowPressed]}>
                <Text numberOfLines={1} adjustsFontSizeToFit style={[styles.rowIcon, row.icon.length > 1 && styles.rowIconWide]}>{row.icon}</Text>
                <View style={styles.rowCopy}><Text style={styles.rowLabel}>{row.label}</Text>{row.hint ? <Text style={styles.rowHint}>{row.hint}</Text> : null}</View>
            </Pressable>)}
            </ScrollView>
        </View>
        </KeyboardAvoidingView>
    </Modal>;
}

// The three entry points shown at the bottom of the simple editor.
export function SimpleEditorBar({ onOpen }: { onOpen(sheet: SimpleSheetName): void }) {
    const items: readonly { id: SimpleSheetName; icon: string; label: string; primary?: boolean }[] = [
        { id: 'add', icon: '＋', label: t('editorSimple.add') },
        { id: 'ai', icon: '✦', label: t('editorSimple.aiEdit'), primary: true },
        { id: 'more', icon: '⋯', label: t('editorSimple.more') },
    ];
    return <View style={styles.bar}>
        {items.map((item) => <Pressable key={item.id} accessibilityRole="button" accessibilityLabel={rawText(item.label)} onPress={() => onOpen(item.id)} style={({ pressed }) => [styles.barButton, item.primary && styles.barPrimary, pressed && styles.rowPressed]}>
            <Text style={[styles.barIcon, item.primary && styles.barPrimaryText]}>{item.icon}</Text>
            <Text style={[styles.barLabel, item.primary && styles.barPrimaryText]}>{item.label}</Text>
        </Pressable>)}
    </View>;
}

const styles = StyleSheet.create({
    backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)' },
    sheet: { gap: 8, paddingHorizontal: 14, paddingTop: 14, paddingBottom: 30, borderTopLeftRadius: 20, borderTopRightRadius: 20, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
    sheetHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingBottom: 4 },
    sheetTitle: { color: colors.text, fontFamily: fonts.display, fontSize: 19 },
    closeButton: { justifyContent: 'center', paddingHorizontal: 8 },
    closeText: { color: colors.accent, fontSize: 15, fontWeight: '700' },
    row: { minHeight: 56, flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 12, borderRadius: 12, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.background },
    rowDisabled: { opacity: 0.4 },
    rowPressed: { opacity: 0.65 },
    rowIcon: { width: 34, color: colors.accent, fontSize: 20, fontWeight: '800', textAlign: 'center' },
    rowIconWide: { fontSize: 15 },
    rowCopy: { flex: 1, minWidth: 0 },
    rowLabel: { color: colors.text, fontSize: 16, fontWeight: '700' },
    rowHint: { color: colors.muted, fontSize: 12, marginTop: 2 },
    bar: { flexDirection: 'row', gap: 10, paddingHorizontal: 12, paddingTop: 8, paddingBottom: 22, borderTopWidth: StyleSheet.hairlineWidth, borderColor: colors.border, backgroundColor: colors.background },
    barButton: { flex: 1, minHeight: 56, alignItems: 'center', justifyContent: 'center', gap: 2, borderRadius: 14, borderWidth: 1, borderColor: colors.borderStrong, backgroundColor: colors.surface },
    barPrimary: { borderColor: colors.accent, backgroundColor: colors.accent },
    barIcon: { color: colors.text, fontSize: 18, fontWeight: '800' },
    barLabel: { color: colors.text, fontSize: 13, fontWeight: '800' },
    barPrimaryText: { color: colors.background },
});
