import { Image } from 'expo-image';
import { View } from 'react-native';
import { t } from '../../lib/i18n';
import type { CrunTemplatePreview } from '../../lib/crunTemplateSummary';
import { Card, Text, themedStyles, useThemedStyles } from '../ui';
import { TemplatePlayButton, TemplateVideoLayer } from './TemplatePreviewControls';

export function CrunTemplateCard({ template, playing, onPlay }: {
    readonly template: CrunTemplatePreview;
    readonly playing: boolean;
    onPlay(): void;
}) {
    const styles = useThemedStyles(sheets);
    const still = template.coverUrl ?? (template.previewKind === 'image' ? template.previewUrl : null);
    const video = template.previewKind === 'video' ? template.previewUrl : null;
    return <Card style={styles.card}>
        <View style={styles.preview} accessibilityLabel={t('crunTemplates.previewLabel', { name: template.name })}>
            {still ? <Image source={{ uri: still }} contentFit="cover" cachePolicy="memory" style={styles.fill} /> : <View style={styles.empty}><Text variant="caption" tone="secondary">{t('crunTemplates.previewUnavailable')}</Text></View>}
            {playing && video ? <TemplateVideoLayer url={video} onFail={onPlay} /> : null}
            {template.tag ? <View style={styles.badge}><Text variant="caption">{template.tag}</Text></View> : null}
        </View>
        <Text variant="bodyStrong">{template.name}</Text>
        {template.category ? <Text variant="caption" tone="secondary">{template.category}</Text> : null}
        {template.inputCount ? <Text variant="caption" tone="secondary">{t('crunTemplates.inputCount', { count: template.inputCount })}</Text> : template.inputRequirement ? <Text variant="caption" tone="secondary">{t('crunTemplates.input', { input: template.inputRequirement })}</Text> : null}
        {template.providerCredits !== null ? <Text variant="caption" tone="secondary">{t('crunTemplates.providerCredits', { credits: template.providerCredits })}</Text> : null}
        <Text variant="caption" tone="secondary">{t('crunTemplates.previewOnly')}</Text>
        {video ? <TemplatePlayButton title={template.name} playing={playing} style={styles.play} onPress={onPlay} /> : null}
    </Card>;
}

const sheets = themedStyles(p => ({
    card: { flex: 1, margin: 4, padding: 8, gap: 6 },
    preview: { width: '100%', aspectRatio: 3 / 4, overflow: 'hidden', borderRadius: 8, backgroundColor: p.bgElevated2 },
    fill: { width: '100%', height: '100%' },
    empty: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 12 },
    badge: { position: 'absolute', top: 8, start: 8, backgroundColor: p.bgElevated1, borderRadius: 8, padding: 4 },
    play: { top: 16, end: 16 },
}));
