import { Switch, View } from 'react-native';
import { Card, Text, themedStyles, useThemedStyles } from '../ui';
import { BeatKeyboard, type BeatKeyboardProps } from './BeatKeyboard';
import type { BeatEditorLayout } from '../../lib/beatNative/editorLayout';
import { t } from '../../lib/i18n';
import { ds } from '../../theme';

export type BeatMidiRecordPhase = 'idle' | 'starting' | 'countIn' | 'recording' | 'finishing';

const STATUS_KEY = {
    idle: 'beat.midiRecord.status.idle',
    starting: 'beat.midiRecord.status.starting',
    countIn: 'beat.midiRecord.status.countIn',
    recording: 'beat.midiRecord.status.recording',
    finishing: 'beat.midiRecord.status.finishing',
} as const;

export type BeatMidiRecordPanelProps = Pick<BeatKeyboardProps,
    'track' | 'velocity' | 'setVelocity' | 'audio' | 'onError' | 'onNoteOn' | 'onNoteOff' | 'clock' | 'accessibilityNoteDurationMs'> & {
    phase: BeatMidiRecordPhase;
    noteCount: number;
    countIn: boolean;
    quantise: boolean;
    onCountInChange(value: boolean): void;
    onQuantiseChange(value: boolean): void;
    countInStep?: number;
    settingsDisabled?: boolean;
    keyboardDisabled?: boolean;
    lockReason?: string;
    layout?: BeatEditorLayout;
};

export function BeatMidiRecordPanel({
    phase, noteCount, countIn, quantise, onCountInChange, onQuantiseChange, countInStep,
    settingsDisabled = false, keyboardDisabled = false, lockReason, layout = 'compact', ...keyboard
}: BeatMidiRecordPanelProps) {
    const s = useThemedStyles(styles);
    const capturing = phase === 'recording';
    const status = phase === 'countIn'
        ? t('beat.midiRecord.countInProgress', { current: countInStep ?? 1, total: 4 })
        : t(STATUS_KEY[phase], phase === 'recording' ? { count: noteCount } : undefined);
    return <Card testID="beat-midi-record-panel" style={s.card} accessible={false}>
        <View style={[s.heading, layout === 'accessible' && s.stack]}>
            <View style={s.headingText}>
                <Text variant="title3">{t('beat.midiRecord.title')}</Text>
                <Text testID="beat-midi-record-status" variant="bodyStrong">
                    {phase === 'recording' || phase === 'finishing' ? '■ ' : ''}{status}
                </Text>
            </View>
            <Text testID="beat-midi-record-note-count" variant="footnote" tone="secondary">
                {t('beat.midiRecord.recorded', { count: noteCount })}
            </Text>
        </View>
        <View style={[s.settings, layout === 'accessible' && s.settingsAccessible]}>
            <View style={s.switchRow}>
                <Text style={s.switchLabel}>{t('beat.midiRecord.countIn')}</Text>
                <Switch testID="beat-midi-count-in" accessibilityLabel={t('beat.midiRecord.countIn')}
                    accessibilityState={{ disabled: settingsDisabled, checked: countIn }}
                    disabled={settingsDisabled} value={countIn} onValueChange={onCountInChange} style={s.switch} />
            </View>
            <View style={s.switchRow}>
                <Text style={s.switchLabel}>{t('beat.midiRecord.quantise')}</Text>
                <Switch testID="beat-midi-quantise" accessibilityLabel={t('beat.midiRecord.quantise')}
                    accessibilityState={{ disabled: settingsDisabled, checked: quantise }}
                    disabled={settingsDisabled} value={quantise} onValueChange={onQuantiseChange} style={s.switch} />
            </View>
        </View>
        {lockReason ? <View testID="beat-midi-record-lock" style={s.lock} accessible accessibilityLabel={lockReason}>
            <Text variant="bodyStrong">{t('beat.midiRecord.locked')}</Text>
            <Text variant="footnote" tone="secondary">{lockReason}</Text>
        </View> : null}
        <BeatKeyboard {...keyboard} captureActive={capturing} disabled={keyboardDisabled} />
    </Card>;
}

const styles = themedStyles(p => ({
    card: { gap: ds.space.lg },
    heading: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'flex-start', justifyContent: 'space-between', gap: ds.space.sm },
    headingText: { flexShrink: 1, gap: ds.space.xs },
    stack: { flexDirection: 'column', alignItems: 'stretch' },
    settings: { flexDirection: 'row', flexWrap: 'wrap', gap: ds.space.md },
    settingsAccessible: { flexDirection: 'column' },
    switchRow: { minHeight: 44, flexGrow: 1, flexBasis: 180, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: ds.space.md },
    switchLabel: { flexShrink: 1 },
    switch: { minWidth: 44, minHeight: 44 },
    lock: { gap: ds.space.xs, borderWidth: 1, borderColor: p.borderStrong, borderRadius: ds.radius.md, padding: ds.space.md },
}));
