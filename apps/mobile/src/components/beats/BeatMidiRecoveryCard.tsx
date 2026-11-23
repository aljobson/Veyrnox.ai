import { Alert, View } from 'react-native';
import { Button, Card, Text, themedStyles, useThemedStyles } from '../ui';
import { rawText } from '../../lib/i18n/translate';
import { t } from '../../lib/i18n';
import { ds } from '../../theme';

export type BeatMidiRecoveryMode = 'restore' | 'retry' | 'conflict' | 'discardOnly';

export type BeatMidiRecoveryCardProps = {
    mode: BeatMidiRecoveryMode;
    message?: string;
    busy?: boolean;
    canRetryWithQuantise?: boolean;
    canSaveAsNew?: boolean;
    onRestore?(): void;
    onRetry?(): void;
    onRetryWithQuantise?(): void;
    onSaveAsNew?(): void;
    onDiscard(): void;
};

const DETAIL_KEY = {
    restore: 'beat.midiRecord.recovery.pending',
    retry: 'beat.midiRecord.status.failed',
    conflict: 'beat.midiRecord.recovery.conflict',
    discardOnly: 'beat.midiRecord.recovery.revoked',
} as const;

export function BeatMidiRecoveryCard({
    mode, message, busy = false, canRetryWithQuantise = false, canSaveAsNew = false,
    onRestore, onRetry, onRetryWithQuantise, onSaveAsNew, onDiscard,
}: BeatMidiRecoveryCardProps) {
    const s = useThemedStyles(styles);
    const detail = message ?? t(DETAIL_KEY[mode]);
    const discard = () => Alert.alert(
        rawText(t('beat.midiRecord.recovery.discardTitle')),
        rawText(t('beat.midiRecord.recovery.discardBody')),
        [
            { text: rawText(t('beat.midiRecord.recovery.cancel')), style: 'cancel' },
            { text: rawText(t('beat.midiRecord.recovery.discard')), style: 'destructive', onPress: onDiscard },
        ],
    );
    return <Card testID="beat-midi-recovery-card" style={s.card} accessible={false}>
        <View style={s.copy} accessible accessibilityLabel={`${t('beat.midiRecord.recovery.title')}. ${detail}`}>
            <Text variant="title3">{t('beat.midiRecord.recovery.title')}</Text>
            <Text variant="body" tone={mode === 'conflict' || mode === 'discardOnly' ? 'warning' : 'secondary'}>
                {mode === 'conflict' || mode === 'discardOnly' ? '⚠ ' : ''}{detail}
            </Text>
        </View>
        <View style={s.actions}>
            {mode === 'restore' ? <Button testID="beat-midi-restore" label={t('beat.midiRecord.recovery.restore')}
                loading={busy} disabled={!onRestore} onPress={onRestore} containerStyle={s.action} /> : null}
            {mode === 'retry' ? <>
                <Button testID="beat-midi-retry" label={t('beat.midiRecord.recovery.retry')}
                    loading={busy} disabled={!onRetry} onPress={onRetry} containerStyle={s.action} />
                {canRetryWithQuantise ? <Button testID="beat-midi-retry-quantise" variant="secondary"
                    label={t('beat.midiRecord.recovery.retryQuantise')} disabled={busy || !onRetryWithQuantise}
                    onPress={onRetryWithQuantise} containerStyle={s.action} /> : null}
            </> : null}
            {(mode === 'retry' || mode === 'conflict') && canSaveAsNew ? <Button testID="beat-midi-save-new"
                variant={mode === 'conflict' ? 'primary' : 'secondary'} label={t('beat.midiRecord.recovery.saveNew')}
                loading={mode === 'conflict' && busy} disabled={busy || !onSaveAsNew}
                onPress={onSaveAsNew} containerStyle={s.action} /> : null}
            <Button testID="beat-midi-discard" variant="destructive" label={t('beat.midiRecord.recovery.discard')}
                disabled={busy} onPress={discard} containerStyle={s.action} />
        </View>
    </Card>;
}

const styles = themedStyles(p => ({
    card: { gap: ds.space.lg, borderWidth: 2, borderColor: p.borderStrong },
    copy: { gap: ds.space.sm },
    actions: { flexDirection: 'row', flexWrap: 'wrap', gap: ds.space.sm },
    action: { minWidth: 148, flexGrow: 1 },
}));
