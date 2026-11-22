import { View } from 'react-native';
import { Image } from 'expo-image';
import { Text, themedStyles, useThemedStyles } from '../ui';
import { t } from '../../lib/i18n';
import { TEMPLATE_PHOTO_COPY, TEMPLATE_PHOTO_LIMITS } from '../../../../../lib/templatePhotoGuidance.mjs';

const PHOTOS = {
    face: { source: require('../../../assets/examples/photo-face.jpg'), aspectRatio: 1 },
    fullBody: { source: require('../../../assets/examples/photo-full-body.jpg'), aspectRatio: 274 / 800 },
} as const;

export function TemplatePhotoExample({ kind = 'face', limits = 'upload' }: { kind?: keyof typeof TEMPLATE_PHOTO_COPY; limits?: keyof typeof TEMPLATE_PHOTO_LIMITS }) {
    const styles = useThemedStyles(sheets), photo = kind === 'scene' ? null : PHOTOS[kind], rule = TEMPLATE_PHOTO_LIMITS[limits];
    const copy = t(TEMPLATE_PHOTO_COPY[kind]), limitCopy = t(rule.key, rule.values);
    return <View style={styles.row} accessible accessibilityLabel={`${t('presets.photoExample.title')}. ${copy} ${limitCopy}`}>
        {photo ? <Image source={photo.source} contentFit="cover" style={[styles.image, { aspectRatio: photo.aspectRatio }]} accessible={false} /> : <View style={styles.frame}><View style={styles.sun} /><View style={styles.ground} /></View>}
        <View style={styles.copy}>
            <Text variant="bodyStrong">{t('presets.photoExample.title')}</Text>
            <Text variant="caption">{copy}</Text>
            <Text variant="caption">{limitCopy}</Text>
        </View>
    </View>;
}
const sheets = themedStyles(p => ({
    row: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 12 },
    image: { height: 128, borderRadius: 8 },
    frame: { width: 96, height: 128, borderRadius: 8, borderWidth: 2, borderStyle: 'dashed' as const, borderColor: p.accent, overflow: 'hidden' as const },
    sun: { position: 'absolute' as const, top: 18, right: 14, width: 18, height: 18, borderRadius: 9, backgroundColor: p.accent, opacity: 0.45 },
    ground: { position: 'absolute' as const, left: 0, right: 0, bottom: 0, height: 42, backgroundColor: p.accent, opacity: 0.7 },
    copy: { flex: 1, gap: 4 },
}));
