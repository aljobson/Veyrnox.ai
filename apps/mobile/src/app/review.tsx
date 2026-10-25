import * as WebBrowser from 'expo-web-browser';
import { Image } from 'expo-image';
import { useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Action, Card, Status, styles as shared } from '../components/account/shared';
import { VEY_CLEARANCE } from '../components/VeyMascot';
import { getLocale, t } from '../lib/i18n';
import { COMMENT_MAX, decideReview, fetchReview, reviewErrorKey, reviewOpen, validToken, type Review } from '../lib/shareLinks';
import { colors, fonts } from '../theme';

// A post review request sent to someone who may not have an account: the link's token is the credential, as on the web,
// so this screen sits outside the signed-in area. It shows the post and takes one decision, approve or reject.
export default function ReviewLink() {
    const { token: raw } = useLocalSearchParams<{ token?: string }>();
    const token = typeof raw === 'string' ? raw : '';
    const [review, setReview] = useState<Review | null>(null);
    const [comment, setComment] = useState('');
    const [error, setError] = useState<string | null>(null);
    const [busy, setBusy] = useState<'approved' | 'rejected' | null>(null);

    useEffect(() => {
        if (!validToken(token)) return;
        let live = true;
        fetchReview(token).then(
            (r) => live && setReview(r),
            (err) => live && setError(t(reviewErrorKey(err))),
        );
        return () => {
            live = false;
        };
    }, [token]);

    async function decide(decision: 'approved' | 'rejected') {
        setBusy(decision);
        setError(null);
        try {
            const out = await decideReview(token, decision, comment);
            setReview((r) => (r ? { ...r, decision: out.decision, requestStatus: out.requestStatus || r.requestStatus } : r));
        } catch (err) {
            setError(t(reviewErrorKey(err)));
        } finally {
            setBusy(null);
        }
    }

    const when = review?.scheduledAt && !Number.isNaN(Date.parse(review.scheduledAt)) ? new Date(review.scheduledAt).toLocaleString(getLocale()) : null;
    return (
        <ScrollView style={styles.screen} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
            <Text style={shared.label}>VEYRNOX PUBLISH</Text>
            <Text style={styles.title} accessibilityRole="header">{t('share.review.title')}</Text>
            {!validToken(token) ? <Text style={shared.help} accessibilityRole="alert">{t('share.review.err.gone')}</Text> : null}
            {error && !review ? <Status text={error} error /> : null}
            {validToken(token) && !review && !error ? <ActivityIndicator color={colors.accent} accessibilityLabel={t('share.loading')} /> : null}
            {review ? (
                <Card title={review.brandName || t('share.review.title')}>
                    {review.networks.length ? <Text style={shared.help}>{review.networks.join(' · ')}</Text> : null}
                    {review.attachments.map((item, index) => <View key={index}>
                        <Text style={shared.label}>{t('app.publish.carousel.item', { count: index + 1 })}</Text>
                        {item.held || !item.previewUrl ? <Text style={shared.help}>{t('app.publish.carousel.unavailable')}</Text>
                            : item.mediaType === 'video' ? <Action label={t('share.review.watch')} onPress={() => void WebBrowser.openBrowserAsync(item.previewUrl as string)} />
                            : <Image source={{ uri: item.previewUrl }} cachePolicy="none" style={styles.media} contentFit="contain" accessibilityLabel={t('share.review.preview')} />}
                    </View>)}
                    {review.targets.length ? (
                        review.targets.map((target) => (
                            <View key={target.network} style={{ gap: 4 }}>
                                <Text style={shared.label}>{target.network}</Text>
                                <Text selectable style={shared.name}>{target.text}</Text>
                            </View>
                        ))
                    ) : review.globalText ? (
                        <Text selectable style={shared.name}>{review.globalText}</Text>
                    ) : null}
                    <Text style={shared.help}>{[when ? t('share.review.planned', { date: when }) : '', review.policy === 'all' ? t('share.review.all') : t('share.review.one')].filter(Boolean).join(' ')}</Text>
                    {reviewOpen(review) ? (
                        <>
                            <Text style={shared.label}>{t('share.review.comment')}</Text>
                            <TextInput accessibilityLabel={t('share.review.comment')} multiline maxLength={COMMENT_MAX} style={[shared.input, { minHeight: 80, paddingTop: 10, textAlignVertical: 'top' }]} value={comment} onChangeText={setComment} placeholderTextColor={colors.muted} />
                            <Action label={busy === 'approved' ? t('share.review.saving') : t('share.review.approve')} disabled={busy !== null} onPress={() => void decide('approved')} />
                            <Action label={busy === 'rejected' ? t('share.review.saving') : t('share.review.reject')} danger disabled={busy !== null} onPress={() => void decide('rejected')} />
                        </>
                    ) : (
                        <Text style={shared.name} accessibilityLiveRegion="polite">{t('share.review.result', { decision: review.decision, status: review.requestStatus })}</Text>
                    )}
                    <Status text={error} error />
                </Card>
            ) : null}
        </ScrollView>
    );
}

const styles = StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.background },
    content: { padding: 16, paddingTop: 56, gap: 16, paddingBottom: 16 + VEY_CLEARANCE },
    title: { color: colors.text, fontFamily: fonts.display, fontSize: 26 },
    media: { width: '100%', height: 280, borderRadius: 12, backgroundColor: '#000' },
});
