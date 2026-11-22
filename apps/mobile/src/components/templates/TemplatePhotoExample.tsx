import { View } from 'react-native';
import { Text, themedStyles, useThemedStyles } from '../ui';
import { t } from '../../lib/i18n';
import { TEMPLATE_PHOTO_COPY, TEMPLATE_PHOTO_LIMITS } from '../../../../../lib/templatePhotoGuidance.mjs';

// Plain outlines only: the guide never shows a real person.
export function TemplatePhotoExample({ kind = 'face', limits = 'upload' }: { kind?: keyof typeof TEMPLATE_PHOTO_COPY; limits?: keyof typeof TEMPLATE_PHOTO_LIMITS }) {
    const styles = useThemedStyles(sheets), rule = TEMPLATE_PHOTO_LIMITS[limits];
    const copy = t(TEMPLATE_PHOTO_COPY[kind]), limitCopy = t(rule.key, rule.values);
    return <View style={styles.row} accessible accessibilityLabel={`${t('presets.photoExample.title')}. ${copy} ${limitCopy}`}>
        <View style={styles.frame}>
            {kind === 'face' ? <><View style={styles.faceHead} /><View style={styles.faceShoulders} /></>
                : kind === 'fullBody' ? <><View style={styles.bodyHead} /><View style={styles.bodyTorso} /><View style={[styles.bodyLeg, styles.legLeft]} /><View style={[styles.bodyLeg, styles.legRight]} /></>
                : <><View style={styles.sun} /><View style={styles.ground} /></>}
        </View>
        <View style={styles.copy}>
            <Text variant="bodyStrong">{t('presets.photoExample.title')}</Text>
            <Text variant="caption">{copy}</Text>
            <Text variant="caption">{limitCopy}</Text>
        </View>
    </View>;
}
const absolute = 'absolute' as const;
const sheets = themedStyles(p => ({
    row: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 12 },
    frame: { width: 96, height: 128, borderRadius: 8, borderWidth: 2, borderStyle: 'dashed' as const, borderColor: p.accent, overflow: 'hidden' as const },
    faceHead: { position: absolute, top: 20, left: 24, width: 44, height: 50, borderRadius: 22, backgroundColor: p.accent, opacity: 0.75 },
    faceShoulders: { position: absolute, bottom: -28, left: 10, width: 72, height: 66, borderRadius: 32, backgroundColor: p.accent, opacity: 0.5 },
    bodyHead: { position: absolute, top: 8, left: 36, width: 20, height: 22, borderRadius: 10, backgroundColor: p.accent, opacity: 0.75 },
    bodyTorso: { position: absolute, top: 33, left: 30, width: 32, height: 40, borderRadius: 6, backgroundColor: p.accent, opacity: 0.5 },
    bodyLeg: { position: absolute, top: 73, width: 13, height: 42, borderRadius: 4, backgroundColor: p.accent, opacity: 0.5 },
    legLeft: { left: 31 },
    legRight: { left: 48 },
    sun: { position: absolute, top: 18, right: 14, width: 18, height: 18, borderRadius: 9, backgroundColor: p.accent, opacity: 0.45 },
    ground: { position: absolute, left: 0, right: 0, bottom: 0, height: 42, backgroundColor: p.accent, opacity: 0.7 },
    copy: { flex: 1, gap: 4 },
}));
