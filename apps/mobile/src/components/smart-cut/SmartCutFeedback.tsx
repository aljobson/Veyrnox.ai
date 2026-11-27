import { useState } from 'react';
import { randomUUID } from 'expo-crypto';
import { TextInput, View } from 'react-native';
import type { ApiClient } from '../../lib/api';
import { rawText } from '../../lib/i18n/translate';
import { t } from '../../lib/i18n';
import { SMART_CUT_FEEDBACK_COMMENT_MAX, submitSmartCutFeedback, type SmartCutFeedbackMode, type SmartCutFeedbackRating } from '../../lib/smartCutFeedback';
import { ds } from '../../theme';
import { Button, Card, Text, themedStyles, useThemedStyles } from '../ui';

export function SmartCutFeedback({ api, responseId, planMode }: {
    readonly api: Pick<ApiClient, 'request'>;
    readonly responseId: string;
    readonly planMode: SmartCutFeedbackMode;
}) {
    const styles = useThemedStyles(sheets);
    const [rating, setRating] = useState<SmartCutFeedbackRating | null>(null);
    const [comment, setComment] = useState('');
    const [state, setState] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
    const [submissionId, setSubmissionId] = useState(responseId);
    const edit = (change: () => void) => { if (state === 'error') setSubmissionId(randomUUID()); change(); setState('idle'); };
    const choose = (value: SmartCutFeedbackRating) => edit(() => setRating(value));
    const send = async () => {
        if (!rating || state === 'sending' || state === 'sent') return;
        setState('sending');
        try {
            await submitSmartCutFeedback(api, { responseId: submissionId, rating, comment, planMode });
            setState('sent');
        } catch { setState('error'); }
    };
    if (state === 'sent') return <Card style={styles.card}><Text accessibilityLiveRegion="polite" variant="footnote">{t('app.smartCut.feedback.thanks')}</Text></Card>;
    return <Card style={styles.card}>
        <Text variant="bodyStrong">{t('app.smartCut.feedback.title')}</Text>
        <View style={styles.actions} accessibilityRole="radiogroup" accessibilityLabel={rawText(t('app.smartCut.feedback.title'))}>
            <Button label={t('app.smartCut.feedback.up')} variant={rating === 'up' ? 'primary' : 'secondary'} accessibilityRole="radio" accessibilityState={{ checked: rating === 'up' }} onPress={() => choose('up')} />
            <Button label={t('app.smartCut.feedback.down')} variant={rating === 'down' ? 'primary' : 'secondary'} accessibilityRole="radio" accessibilityState={{ checked: rating === 'down' }} onPress={() => choose('down')} />
        </View>
        {rating ? <>
            <Text variant="footnote" tone="secondary">{t('app.smartCut.feedback.comment')}</Text>
            <TextInput accessibilityLabel={rawText(t('app.smartCut.feedback.comment'))} value={comment} multiline maxLength={SMART_CUT_FEEDBACK_COMMENT_MAX} placeholder={t('app.smartCut.feedback.placeholder')} placeholderTextColor={styles.placeholder.color} onChangeText={(value) => edit(() => setComment(value))} style={styles.input} />
            <Text variant="footnote" tone="secondary">{t('app.smartCut.feedback.privacy')}</Text>
            <Button label={t(state === 'sending' ? 'app.smartCut.feedback.sending' : 'app.smartCut.feedback.send')} loading={state === 'sending'} disabled={state === 'sending'} onPress={() => void send()} />
            {state === 'error' ? <Text accessibilityRole="alert" tone="danger">{t('app.smartCut.feedback.error')}</Text> : null}
        </> : null}
    </Card>;
}

const sheets = themedStyles((p) => ({
    placeholder: { color: p.textTertiary },
    card: { padding: ds.space.md, gap: ds.space.sm, backgroundColor: p.bg },
    actions: { flexDirection: 'row', flexWrap: 'wrap', gap: ds.space.sm },
    input: { minHeight: 88, paddingHorizontal: ds.space.md, paddingVertical: ds.space.sm, color: p.textPrimary, backgroundColor: p.bgElevated1, borderColor: p.borderStrong, borderWidth: 1, borderRadius: ds.radius.md, textAlignVertical: 'top' },
}));
