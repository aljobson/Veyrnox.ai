import { useReducedMotion } from '../ui/useReducedMotion';
import { useContext, useState } from 'react';
import { SafeAreaInsetsContext } from 'react-native-safe-area-context';
import { mobileEditorAction } from '../../lib/editorIntentRouter';
import { Icon, Text as UiText, TextField, Button as UiButton } from '../ui';
import { Modal, Pressable, ScrollView, KeyboardAvoidingView, Platform, StyleSheet, Text, View } from 'react-native';
import { touchTarget } from '../../lib/a11y';
import { runAfterSheetCloses } from './runAfterSheetCloses';
import { rawText } from '../../lib/i18n/translate';
import { t } from '../../lib/i18n';
import { studioColors as colors, fonts } from '../../theme';
import { MENU_ICONS, type MenuIcon } from '../../lib/menuIcons';

export interface SheetRow { id: string; icon: MenuIcon | string; label: string; hint?: string; disabled?: boolean; afterClose?: boolean; onPress(): void }
export type SimpleSheetName = 'add' | 'ai' | 'cut' | 'sound' | 'text' | 'layers' | 'more';
export type SimpleDockTab = 'ai' | 'cut' | 'audio' | 'text' | 'media';

function EditorToolIcon({ name, size = 24, active = false, muted = false }: { name: MenuIcon | string; size?: 20 | 24 | 28; active?: boolean; muted?: boolean }) {
    const tint = active ? colors.accent : muted ? '#a0a0a7' : '#f1f1f2';
    if (name in MENU_ICONS) return <Icon name={name as MenuIcon} size={size} tint={tint} />;
    return <Text style={[styles.fallbackIcon, muted && styles.mutedInk, active && styles.activeInk]}>{name}</Text>;
}

// One bottom sheet for all three entries. Choosing a row closes the sheet first, then runs the action;
// a row marked afterClose (a native picker) waits until the sheet has finished closing.
export function SimpleEditorSheet({ title, rows, onClose, testID, describe = false, onDescribe }: { title: string; rows: readonly SheetRow[]; onClose(): void; testID?: string; describe?: boolean; onDescribe?(id: string, prompt: string): void }) {
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
        <View testID={testID} style={[styles.sheet, { flexShrink: 1 }]}>
            <View style={styles.sheetHeader}>
                <Text accessibilityRole="header" style={styles.sheetTitle}>{title}</Text>
                <Pressable accessibilityRole="button" accessibilityLabel={rawText(t('editorSimple.close'))} onPress={onClose} style={[styles.closeButton, touchTarget]}><Icon name="close" size={24} tint={colors.accent} /></Pressable>
            </View>
            <ScrollView style={{ flexShrink: 1 }} keyboardShouldPersistTaps="handled" contentContainerStyle={{ gap: 8 }}>
            {describe ? <View style={{ gap: 8 }}>
                <TextField label={t('editorSimple.describe')} accessibilityLabel={rawText(t('editorSimple.describe'))} value={prompt} onChangeText={value => { setPrompt(value); setProblem(''); }} maxLength={500} onSubmitEditing={openDescribed} />
                <UiText variant="footnote">{t('editorSimple.promptHelp')}</UiText>
                {problem ? <UiText variant="footnote" accessibilityRole="alert" accessibilityLiveRegion="polite">{problem}</UiText> : null}
                <UiButton label={t('editorSimple.openTool')} accessibilityLabel={rawText(t('editorSimple.openTool'))} disabled={!prompt.trim()} onPress={openDescribed} />
            </View> : null}
            {rows.map((row) => <Pressable key={row.id} accessibilityRole="button" accessibilityLabel={rawText(row.label)} accessibilityState={{ disabled: !!row.disabled }} disabled={row.disabled} onPress={() => { onClose(); if (row.afterClose) runAfterSheetCloses(row.onPress); else row.onPress(); }} style={({ pressed }) => [styles.row, row.disabled && styles.rowDisabled, pressed && styles.rowPressed]}>
                <View style={styles.rowIcon}><EditorToolIcon name={row.icon} /></View>
                <View style={styles.rowCopy}><Text style={styles.rowLabel}>{row.label}</Text>{row.hint ? <Text style={styles.rowHint}>{row.hint}</Text> : null}</View>
            </Pressable>)}
            </ScrollView>
        </View>
        </KeyboardAvoidingView>
    </Modal>;
}

// ByeCut-style editor dock. Each tab reuses a real Veyrnox editor panel; the dock stays visible
// while a panel is open so switching tools never requires closing and reopening the sheet.
export function SimpleEditorBar({ active, trayOpen = false, onOpen }: {
    active: SimpleDockTab;
    trayOpen?: boolean;
    onOpen(sheet: SimpleSheetName): void;
}) {
    const items: readonly { id: SimpleDockTab; icon: MenuIcon; label: string; onPress(): void }[] = [
        { id: 'ai', icon: 'sparkle', label: t('editorSimple.aiEdit'), onPress: () => onOpen('ai') },
        { id: 'cut', icon: 'scissors', label: t('editorSimple.cut'), onPress: () => onOpen('cut') },
        { id: 'audio', icon: 'waveform', label: t('editorSimple.sound'), onPress: () => onOpen('sound') },
        { id: 'text', icon: 'chatText', label: t('editorSimple.text'), onPress: () => onOpen('text') },
        { id: 'media', icon: 'squares', label: t('editorSimple.layers'), onPress: () => onOpen('layers') },
    ];
    // Keep the bar above the home indicator; the panel above it scrolls instead of pushing the bar off screen.
    const bottom = useContext(SafeAreaInsetsContext)?.bottom ?? 0;
    return <View style={[styles.bar, { paddingBottom: trayOpen ? 7 : Math.max(22, bottom + 8) }]}>
        {items.map((item) => <Pressable key={item.id} accessibilityRole="button" accessibilityLabel={rawText(item.label)} accessibilityState={{ selected: active === item.id }} onPress={item.onPress} style={({ pressed }) => [styles.barButton, active === item.id && styles.barPrimary, pressed && styles.rowPressed]}>
            <EditorToolIcon name={item.icon} size={24} active={active === item.id} muted={active !== item.id} />
            <Text style={[styles.barLabel, active === item.id && styles.activeInk]}>{item.label}</Text>
        </Pressable>)}
    </View>;
}

// ByeCut keeps the active tool's shortcuts visible below the five-tab dock. This is deliberately
// not a modal: editors can scrub the timeline and switch tools without dismissing anything.
export function SimpleEditorTray({ rows }: { rows: readonly SheetRow[] }) {
    const bottom = useContext(SafeAreaInsetsContext)?.bottom ?? 0;
    return <View style={[styles.tray, { paddingBottom: Math.max(10, bottom + 4) }]}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.trayContent}>
            {rows.map((row) => <Pressable key={row.id} accessibilityRole="button" accessibilityLabel={rawText(row.label)} accessibilityState={{ disabled: !!row.disabled }}
                disabled={row.disabled} onPress={row.onPress} style={({ pressed }) => [styles.trayButton, row.disabled && styles.rowDisabled, pressed && styles.rowPressed]}>
                <View style={styles.trayIcon}><EditorToolIcon name={row.icon} size={24} /></View>
                <Text numberOfLines={2} style={styles.trayLabel}>{row.label}</Text>
            </Pressable>)}
        </ScrollView>
    </View>;
}

const styles = StyleSheet.create({
    backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)' },
    sheet: { gap: 8, paddingHorizontal: 14, paddingTop: 14, paddingBottom: 30, borderTopLeftRadius: 20, borderTopRightRadius: 20, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
    sheetHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingBottom: 4 },
    sheetTitle: { color: colors.text, fontFamily: fonts.display, fontSize: 19 },
    closeButton: { alignItems: 'center', justifyContent: 'center' },
    row: { minHeight: 56, flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 8, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: colors.border, backgroundColor: 'transparent' },
    rowDisabled: { opacity: 0.4 },
    rowPressed: { opacity: 0.65 },
    rowIcon: { width: 34, alignItems: 'center', justifyContent: 'center' },
    rowCopy: { flex: 1, minWidth: 0 },
    rowLabel: { color: colors.text, fontSize: 16, fontWeight: '700' },
    rowHint: { color: colors.muted, fontSize: 12, marginTop: 2 },
    bar: { flexShrink: 0, flexDirection: 'row', gap: 3, paddingHorizontal: 8, paddingTop: 7, paddingBottom: 7, borderTopWidth: StyleSheet.hairlineWidth, borderColor: '#29292c', backgroundColor: '#171719' },
    barButton: { flex: 1, minWidth: 0, minHeight: 58, alignItems: 'center', justifyContent: 'center', gap: 3, backgroundColor: 'transparent' },
    barPrimary: { backgroundColor: 'transparent' },
    barLabel: { color: '#a0a0a7', fontSize: 12, fontWeight: '800' },
    activeInk: { color: colors.accent },
    mutedInk: { color: '#a0a0a7' },
    fallbackIcon: { color: '#f1f1f2', fontSize: 22, lineHeight: 26, fontWeight: '800', textAlign: 'center' },
    tray: { flexShrink: 0, borderTopWidth: StyleSheet.hairlineWidth, borderColor: '#2b2b2e', backgroundColor: '#1a1a1c' },
    trayContent: { minWidth: '100%', paddingHorizontal: 8, paddingTop: 10, gap: 6 },
    trayButton: { width: 82, minHeight: 58, alignItems: 'center', justifyContent: 'flex-start', gap: 4, paddingHorizontal: 4 },
    trayIcon: { height: 26, alignItems: 'center', justifyContent: 'center' },
    trayLabel: { color: '#f1f1f2', fontSize: 12, lineHeight: 15, fontWeight: '600', textAlign: 'center' },
});
