import { useState, type ComponentProps } from 'react';
import { AccessibilityInfo, Alert, Modal, Platform, Pressable, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { plural, rawText, t } from '../../../lib/i18n';
import type { CustomFont } from '../../../lib/nativeEditorModel';
import { colors, fonts as themeFonts } from '../../../theme';
import { touchTarget } from '../../../lib/a11y';
import type { EditorFontActions } from '../useEditorFonts';
import { Action } from '../EditorControls';
import { Text as UiText } from '../../ui';
import { KeyboardScreen } from '../../KeyboardScreen';
import { KeyboardFormScrollView } from '../../KeyboardFormScrollView';

type Props = {
    visible: boolean; fonts: readonly CustomFont[]; actions: EditorFontActions; used: Readonly<Record<string, number>>;
    selected?: string; onUse?(family: string): void; onClose(): void;
};
const empty = { name: '', credit: '', usage: '', url: '', confirmed: false };

export function CustomFontLibrarySheet({ visible, fonts, actions, used, selected, onUse, onClose }: Props) {
    const [adding, setAdding] = useState(false), [form, setForm] = useState(empty);
    const set = (key: keyof typeof form, value: string | boolean) => setForm(current => ({ ...current, [key]: value }));
    const importFont = async () => {
        const clean = (value: string) => value.replace(/\s+/g, ' ').trim();
        const added = await actions.add({ name: clean(form.name), rights: { credit: clean(form.credit), usage: clean(form.usage), url: form.url.trim() } });
        if (added) { setForm(empty); setAdding(false); }
    };
    const licenceValid = (() => { if (!form.url.trim()) return true; try { const value = new URL(form.url.trim()); return value.protocol === 'https:' && !value.username && !value.password; } catch { return false; } })();
    const canImport = form.confirmed && !!form.usage.trim() && licenceValid && !actions.busy;
    const remove = (font: CustomFont) => Alert.alert(rawText(t('editorFont.removeConfirmTitle')), rawText(t('editorFont.removeConfirmBody')), [
        { text: rawText(t('editorFont.cancel')), style: 'cancel' },
        { text: rawText(t('editorFont.removeConfirm')), style: 'destructive', onPress: () => { void actions.remove(font); } },
    ]);
    return <Modal visible={visible} animationType="slide" presentationStyle={Platform.OS === 'ios' ? 'pageSheet' : 'fullScreen'} allowSwipeDismissal={!actions.busy}
        onRequestClose={() => { if (!actions.busy) onClose(); }} accessibilityViewIsModal>
        <SafeAreaView style={sheet.screen} edges={['top', 'right', 'bottom', 'left']}>
            <View style={sheet.header}>
                <Pressable accessibilityRole="button" accessibilityLabel={rawText(t('editorFont.close'))} style={({ pressed }) => [sheet.headerAction, touchTarget, pressed && sheet.pressed]}
                    disabled={!!actions.busy} onPress={onClose}><Text style={[sheet.headerActionText, !!actions.busy && sheet.disabled]}>{t('editorFont.close')}</Text></Pressable>
                <Text accessibilityRole="header" style={sheet.title}>{t('editorFont.title')}</Text><View style={sheet.headerAction} />
            </View>
            <KeyboardScreen><KeyboardFormScrollView contentContainerStyle={sheet.content} keyboardShouldPersistTaps="handled">
                <Text style={sheet.intro}>{t('editorFont.help')}</Text>
                {fonts.map(font => {
                    const ready = actions.has(font.family), count = used[font.family] ?? 0, isSelected = selected === font.family;
                    return <View key={font.family} style={[sheet.card, isSelected && sheet.selected]}>
                        <Text accessibilityState={{ selected: isSelected }} style={[sheet.sample, ready && { fontFamily: font.family }]}>{font.name}</Text>
                        {isSelected ? <Text style={sheet.inUse}>✓ {t('editorFont.inUse')}</Text> : null}
                        <Text style={sheet.meta}>{font.sourceName}{font.rights.credit ? ' · ' + font.rights.credit : ''}</Text>
                        <Text accessibilityRole="text" style={[sheet.status, ready && sheet.ready]}>{actions.busy === font.family || actions.checking ? t('editorFont.checking') :
                            actions.failed(font.family) ? t('editorFont.unsupportedOnIphone') : ready ? t('editorFont.ready') :
                            t('editorFont.relinkNeeded')}</Text>
                        <Text style={sheet.usage}>{font.rights.usage}</Text>
                        {count ? <Text style={sheet.meta}>{plural('editorFont.usedCount', count)}</Text> : null}
                        <View style={sheet.actions}>
                            <Action label={t('editorFont.use', { name: font.name })} disabled={!ready || isSelected || !onUse || !!actions.busy} onPress={() => onUse?.(font.family)} />
                            <Action label={t('editorFont.relink', { name: font.name })} disabled={!!actions.busy} onPress={() => void actions.relink(font)} />
                            <Action label={t('editorFont.remove', { name: font.name })} disabled={count > 0 || !!actions.busy} danger onPress={() => remove(font)} />
                        </View>
                    </View>;
                })}
                {fonts.length === 0 ? <View style={sheet.empty}><Text style={sheet.emptyTitle}>{t('editorFont.emptyTitle')}</Text><Text style={sheet.intro}>{t('editorFont.emptyBody')}</Text></View> : null}
                {actions.problem ? <UiText accessibilityRole="alert" style={sheet.error}>{actions.problem}</UiText> : null}
                {adding ? <View style={sheet.form}>
                    <Text accessibilityRole="header" style={sheet.formTitle}>{t('editorFont.importTitle')}</Text>
                    <FontField label={t('editorFont.name')} value={form.name} maxLength={80} onChangeText={value => set('name', value)} />
                    <FontField label={t('editorFont.credit')} value={form.credit} maxLength={120} onChangeText={value => set('credit', value)} />
                    <FontField label={t('editorFont.usage')} value={form.usage} maxLength={240} multiline onChangeText={value => set('usage', value)} />
                    <FontField label={t('editorFont.licence')} value={form.url} maxLength={1000} keyboardType="url" autoCapitalize="none" onChangeText={value => set('url', value)} />
                    {!licenceValid ? <UiText accessibilityRole="alert" style={sheet.error}>{t('editorFont.invalidMetadata')}</UiText> : null}
                    <View style={sheet.switchRow}><Text accessible={false} style={sheet.switchLabel}>{t('editorFont.permission')}</Text><Switch accessibilityLabel={rawText(t('editorFont.permission'))}
                        value={form.confirmed} onValueChange={value => set('confirmed', value)} /></View>
                    <View style={sheet.actions}><Action label={t('editorFont.choose')} disabled={!canImport} onPress={() => void importFont()} /><Action label={t('editorFont.cancel')}
                        disabled={!!actions.busy} onPress={() => { setForm(empty); setAdding(false); }} /></View>
                    {actions.busy === 'new' ? <UiText accessibilityLiveRegion="polite" style={sheet.status}>{t('editorFont.checking')}</UiText> : null}
                </View> : <Action label={t('editorFont.add')} disabled={!!actions.busy || fonts.length >= 8} onPress={() => { actions.clearProblem(); setAdding(true);
                    AccessibilityInfo.announceForAccessibility(t('editorFont.importTitle')); }} />}
                <Text style={sheet.note}>{t('editorFont.note')}</Text><Text style={sheet.note}>{t('editorFont.exportNote')}</Text>
            </KeyboardFormScrollView></KeyboardScreen>
        </SafeAreaView>
    </Modal>;
}

function FontField({ label, ...props }: { label: string } & ComponentProps<typeof TextInput>) {
    return <View style={sheet.field}><Text style={sheet.label}>{label}</Text><TextInput {...props} accessibilityLabel={rawText(label)} placeholderTextColor={colors.muted}
        style={[sheet.input, props.multiline && sheet.multiline]} /></View>;
}

const sheet = StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.background },
    header: { minHeight: 56, flexDirection: 'row', alignItems: 'center', borderBottomWidth: StyleSheet.hairlineWidth, borderColor: colors.border, paddingHorizontal: 8 },
    headerAction: { width: 88, minHeight: 44, justifyContent: 'center', paddingHorizontal: 8 }, headerActionText: { color: colors.accent, fontSize: 16, fontWeight: '700' },
    title: { flex: 1, color: colors.text, fontFamily: themeFonts.display, fontSize: 18, textAlign: 'center' }, content: { padding: 16, paddingBottom: 40, gap: 14 },
    intro: { color: colors.body, fontSize: 16, lineHeight: 22 }, card: { gap: 7, padding: 14, borderRadius: 14, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
    selected: { borderColor: colors.accent }, sample: { color: colors.text, fontSize: 22 }, meta: { color: colors.muted, fontSize: 13, lineHeight: 18 },
    status: { color: colors.body, fontSize: 14, fontWeight: '700' }, ready: { color: colors.accent }, inUse: { color: colors.accent, fontSize: 14, fontWeight: '800' },
    error: { color: colors.danger, fontSize: 15, lineHeight: 21, fontWeight: '700' }, usage: { color: colors.body, fontSize: 15, lineHeight: 21 },
    actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 }, empty: { gap: 4, padding: 16, borderRadius: 14, borderWidth: 1, borderStyle: 'dashed', borderColor: colors.borderStrong },
    emptyTitle: { color: colors.text, fontSize: 17, fontWeight: '800' }, form: { gap: 12, padding: 14, borderRadius: 14, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
    formTitle: { color: colors.text, fontFamily: themeFonts.display, fontSize: 19 }, field: { gap: 6 }, label: { color: colors.body, fontSize: 14, fontWeight: '700' },
    input: { minHeight: 44, color: colors.text, fontSize: 16, paddingHorizontal: 12, paddingVertical: 10, borderRadius: 10, borderWidth: 1, borderColor: colors.borderStrong,
        backgroundColor: colors.background }, multiline: { minHeight: 88, textAlignVertical: 'top' },
    switchRow: { minHeight: 52, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 }, switchLabel: { flex: 1, color: colors.body, fontSize: 16, lineHeight: 22 },
    note: { color: colors.muted, fontSize: 13, lineHeight: 18 }, pressed: { opacity: .62 }, disabled: { opacity: .45 },
});
