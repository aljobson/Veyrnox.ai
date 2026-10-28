import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { View } from 'react-native';
import { useAuth } from '../../auth/AuthProvider';
import { commentsPreview, type CommentsPreviewResult } from '../../lib/cinemaViewer';
import { formatLocale, t } from '../../lib/i18n';
import { Button, Card, Text } from '../ui';

export function CommentsPreview({ contentId }: { contentId: string }) {
    const { api } = useAuth();
    const router = useRouter();
    const [result, setResult] = useState<CommentsPreviewResult | null>(null);
    const [retry, setRetry] = useState(0);
    useFocusEffect(useCallback(() => {
        let live = true;
        setResult(null);
        void commentsPreview(api, contentId).then(next => { if (live) setResult(next); });
        return () => { live = false; };
    }, [api, contentId, retry]));
    if (!result || result.kind === 'hidden') return null;
    if (result.kind === 'error') return <Button variant="tertiary" label={t(result.key)} onPress={() => setRetry(n => n + 1)} />;
    return <Card style={{ gap: 8 }}>
        <Text variant="title3" accessibilityRole="header">{t('comments.title')}</Text>
        {result.comments.length ? result.comments.map(comment => <View key={comment.id} style={{ gap: 4 }}>
            <Text variant="bodyStrong">{comment.displayName}</Text>
            {comment.createdAt ? <Text variant="caption" tone="secondary">{new Date(comment.createdAt).toLocaleDateString(formatLocale())}</Text> : null}
            <Text numberOfLines={3}>{comment.body}</Text>
        </View>) : <Text tone="secondary">{t('comments.none')}</Text>}
        <Button variant="secondary" label={t('cinemaViewer.openComments')} onPress={() => router.push({ pathname: '/cinema/comments', params: { id: contentId } })} />
    </Card>;
}
