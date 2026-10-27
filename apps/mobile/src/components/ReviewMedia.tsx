import { Image } from 'expo-image';
import { useState } from 'react';
import { View } from 'react-native';
import { InlineMedia } from './InlineMedia';
import { Button, Text, themedStyles, useThemedStyles } from './ui';
import { t } from '../lib/i18n';
import type { ReviewAttachment } from '../lib/shareLinks';
import { ds } from '../theme';

export function ReviewMedia({ attachments }: { attachments: readonly ReviewAttachment[] }) {
    const styles = useThemedStyles(sheets);
    const [loaded, setLoaded] = useState<number | null>(null);
    return <>{attachments.map((item, index) => <View key={index}>
        <Text variant="caption" tone="secondary">{t('app.publish.carousel.item', { count: index + 1 })}</Text>
        {item.held || !item.previewUrl ? <Text tone="secondary">{t('app.publish.carousel.unavailable')}</Text>
            : item.mediaType !== 'video' ? <Image source={{ uri: item.previewUrl }} cachePolicy="none" style={styles.media} contentFit="contain" accessibilityLabel={t('share.review.preview')} />
            : loaded === index ? <InlineMedia key={item.previewUrl} url={item.previewUrl} label={t('share.review.watch')} />
            // The review response has no thumbnail: use a static poster until tapped.
            // Selecting another attachment unmounts, pauses and releases the previous player.
            : <Button variant="secondary" style={styles.media} label={t('share.review.loadVideo', { count: index + 1 })} onPress={() => setLoaded(index)} />}
    </View>)}</>;
}
const sheets = themedStyles(p => ({
    media: { width: '100%', height: 280, borderRadius: ds.radius.md, backgroundColor: p.bgElevated1 },
}));
