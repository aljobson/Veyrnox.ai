import { useState } from 'react';
import { I18nManager, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { touchTarget } from '../../lib/a11y';
import { formatTimecode, parseTimecode } from '../../lib/editorTimeline';
import { t } from '../../lib/i18n';
import { colors } from '../../theme';
import { Icon } from '../ui/Icon';
import { Text as StatusText } from '../ui/Text';
import { styles } from './fullEditorStyles';

type Props = { frame: number; total: number; fps: number; playing: boolean; onSeek(frame: number): void; onPlaying(playing: boolean): void };
export function EditorTransport({ frame, total, fps, playing, onSeek, onPlaying }: Props) {
    const [entry, setEntry] = useState<string | null>(null);
    const [invalid, setInvalid] = useState(false);
    const seek = (value: number) => { onPlaying(false); onSeek(Math.max(0, Math.min(Math.max(0, total - 1), value))); };
    const submit = () => {
        const value = parseTimecode(entry ?? '', fps);
        if (value === null) { setInvalid(true); return; }
        seek(value); setInvalid(false); setEntry(null);
    };
    const button = (label: string, disabled: boolean, onPress: () => void, direction: -1 | 1, edge = false) => <Pressable key={label} accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled }} disabled={disabled} onPress={onPress} style={[local.button, touchTarget, disabled && styles.disabled]}>
        <View style={[local.symbol, { transform: [{ scaleX: direction }] }]}><View style={{ transform: [{ scaleX: I18nManager.isRTL ? -1 : 1 }] }}><Icon name="caretRight" size={20} tint={colors.text} /></View>{edge ? <View style={local.bar} /> : null}</View>
    </Pressable>;
    return <View>
        <View style={local.buttons}>
            {button(t('editor.gotostart'), total <= 0 || frame <= 0, () => seek(0), -1, true)}
            {button(t('editorCore.previousFrame'), total <= 0 || frame <= 0, () => seek(frame - 1), -1)}
            <Pressable accessibilityRole="button" accessibilityLabel={playing ? t('editor.pause') : t('editor.play')} accessibilityState={{ disabled: total <= 0 }} disabled={total <= 0} onPress={() => onPlaying(!playing)} style={[local.button, touchTarget, total <= 0 && styles.disabled]}>
                {playing ? <View style={local.symbol}><View style={local.bar} /><View style={local.bar} /></View> : <Icon name="play" size={24} tint={colors.accent} />}
            </Pressable>
            {button(t('editor.nextframe'), total <= 0 || frame >= total - 1, () => seek(frame + 1), 1)}
            {button(t('editorCore.goToEnd'), total <= 0 || frame >= total - 1, () => seek(total - 1), 1, true)}
        </View>
        <View style={local.time}>
            {entry === null ? <Pressable accessibilityRole="button" accessibilityLabel={t('editorCore.enterTimecode')} onPress={() => { setEntry(formatTimecode(frame, fps)); setInvalid(false); }} style={touchTarget}><Text style={styles.timecode}>{formatTimecode(frame, fps)}</Text></Pressable>
                : <TextInput autoFocus accessibilityLabel={t('editorCore.enterTimecode')} value={entry} keyboardType="numbers-and-punctuation" returnKeyType="done" submitBehavior="submit" onChangeText={setEntry} onSubmitEditing={submit} onBlur={() => { setEntry(null); setInvalid(false); }} style={styles.input} />}
            <Text style={styles.totalTime}>{t('editorCore.totalTime', { value1: formatTimecode(total, fps) })}</Text>
        </View>
        {invalid ? <StatusText variant="inherit" accessibilityRole="alert" style={styles.problem}>{t('editorCore.timecodeInvalid')}</StatusText> : null}
    </View>;
}
const local = StyleSheet.create({ buttons: { flexDirection: 'row', justifyContent: 'center' }, button: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }, symbol: { flexDirection: 'row', alignItems: 'center', gap: 4 }, bar: { width: 3, height: 16, backgroundColor: colors.text }, time: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 8 } });
