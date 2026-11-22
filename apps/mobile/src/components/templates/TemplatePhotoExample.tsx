import { View } from 'react-native';
import { Image } from 'expo-image';
import { Text, themedStyles, useThemedStyles } from '../ui';
import { t } from '../../lib/i18n';

const EXAMPLES = {
    face: { source: require('../../../assets/examples/photo-face.jpg'), aspectRatio: 1, copy: 'presets.photoExample.face' },
    fullBody: { source: require('../../../assets/examples/photo-full-body.jpg'), aspectRatio: 274 / 800, copy: 'presets.photoExample.fullBody' },
} as const;

export function TemplatePhotoExample({ kind = 'face' }: { kind?: keyof typeof EXAMPLES }) {
    const styles = useThemedStyles(sheets), example = EXAMPLES[kind];
    return <View style={styles.row} accessible accessibilityLabel={`${t('presets.photoExample.title')}. ${t(example.copy)} ${t('presets.photoExample.limits', { size: 20, side: 256 })}`}>
        <Image source={example.source} contentFit="cover" style={[styles.image, { aspectRatio: example.aspectRatio }]} accessible={false} />
        <View style={styles.copy}>
            <Text variant="bodyStrong">{t('presets.photoExample.title')}</Text>
            <Text variant="caption">{t(example.copy)}</Text>
            <Text variant="caption">{t('presets.photoExample.limits', { size: 20, side: 256 })}</Text>
        </View>
    </View>;
}
const sheets = themedStyles(() => ({ row: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 12 }, image: { height: 128, borderRadius: 8 }, copy: { flex: 1, gap: 4 } }));
