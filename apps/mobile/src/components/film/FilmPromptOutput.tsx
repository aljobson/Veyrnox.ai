import { rawText } from '../../lib/i18n/translate';
import { useState } from 'react';
import { AccessibilityInfo, Platform, Pressable, Share, Text, TextInput, View } from 'react-native';
import { useRouter } from 'expo-router';
import { copyText } from '../../lib/clipboard';
import { promptOpenState } from '../../lib/filmStudioOptions';
import { textInput, type CatalogModel } from '../../lib/media';
import type { Film } from '../../lib/filmStudio';
import { t } from '../../lib/i18n';
import { colors } from '../../theme';
import { Text as StatusText } from '../ui/Text';

export type StageProps = { film: Film; change: (film: Film) => void; catalog: readonly CatalogModel[]; live: boolean };
export function FilmAction({ label, onPress, disabled = false }: { label: string; onPress: () => void; disabled?: boolean }) {
    return <Pressable accessibilityRole="button" accessibilityLabel={rawText(label)} accessibilityState={{ disabled }} disabled={disabled} onPress={onPress}
        style={{ minHeight: 44, justifyContent: 'center', padding: 12, borderWidth: 1, borderColor: colors.border, borderRadius: 12, opacity: disabled ? 0.5 : 1 }}>
        <Text style={{ color: colors.accent }}>{label}</Text></Pressable>;
}
export function FilmInput({ label, value, onChange, disabled = false, multiline = false, maxLength = 24_000 }: {
    label: string; value: string; onChange: (value: string) => void; disabled?: boolean; multiline?: boolean; maxLength?: number;
}) {
    return <View style={{ gap: 6 }}><Text style={{ color: colors.body }}>{label}</Text><TextInput accessibilityLabel={rawText(label)}
        accessibilityState={{ disabled }} editable={!disabled} value={value} onChangeText={v => { if (!disabled) onChange(v); }}
        multiline={multiline} maxLength={maxLength} style={{ minHeight: multiline ? 110 : 44, color: colors.text, borderWidth: 1, borderColor: colors.border, borderRadius: 12, padding: 12 }} /></View>;
}
export function FilmPromptOutput({ title, prompt, modelId, access, catalog, live, aspect, duration }: {
    title: string; prompt: string; modelId: string; access: string; catalog: readonly CatalogModel[]; live: boolean; aspect?: string; duration?: number;
}) {
    const router = useRouter(), [notice, setNotice] = useState('');
    const model = catalog.find(m => m.id === modelId);
    const state = promptOpenState(model, { access, live, prompt, aspect, duration });
    const copy = async () => {
        const message = t(await copyText(prompt) ? 'filmOutput.copied' : 'filmOutput.copyFailed');
        setNotice(message); AccessibilityInfo.announceForAccessibility(message);
    };
    return <View style={{ gap: 10 }}>
        <Text accessibilityRole="header" style={{ color: colors.text, fontWeight: '700' }}>{title}</Text>
        <Text selectable style={{ fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace', color: colors.body, padding: 12, backgroundColor: colors.surface }}>{prompt}</Text>
        <FilmAction label={t('filmOutput.copy')} onPress={() => void copy()} />
        <FilmAction label={t('film.sharethefullprompt')} onPress={() => void Share.share({ message: prompt })} />
        {notice ? <StatusText variant="inherit" accessibilityLiveRegion={Platform.OS === 'android' ? 'polite' : undefined} style={{ color: colors.body }}>{notice}</StatusText> : null}
        {state.ok ? <><FilmAction label={t('film.openinCreate')} onPress={() => router.push({ pathname: '/create/[modelId]',
            params: { modelId, prompt, ...(duration === undefined ? {} : { duration: String(duration) }), ...(aspect ? { aspect } : {}) } })} />
            <Text style={{ color: colors.muted }}>{t('filmOutput.createNote')}</Text></> : access === 'Studio' ?
            <Text style={{ color: colors.muted }}>{t(state.reason === 'limit' ? 'filmOutput.reason.limit' : state.reason === 'duration' ? 'filmOutput.reason.duration' : state.reason === 'aspect' ? 'filmOutput.reason.aspect' : 'filmOutput.reason.catalog', { value1: model ? textInput(model)?.max ?? 0 : 0 })}</Text> : null}
    </View>;
}
