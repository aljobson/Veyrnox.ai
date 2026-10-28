import type { ReactNode } from 'react';
import { View } from 'react-native';
import { Text, Icon, themedStyles, useThemedStyles } from '../ui';
import { SectionLabel } from './SectionLabel';
import { ds } from '../../theme';
import { MIN_TARGET } from '../../lib/a11y';
import { t } from '../../lib/i18n';

export function FormHeader({ modelLabel, modality, stageLine, stage }: { modelLabel: string; modality: string; stageLine: string; stage?: ReactNode }) {
    const styles = useThemedStyles(sheets);
    return <>
                <View style={styles.hero}>
                    <View style={styles.heroTop}>
                        <View style={styles.heroCopy}>
                            <Text variant="title1" tone="primary" style={styles.title} accessibilityRole="header">{t('label.Create')}</Text>
                        </View>
                        <View style={styles.savedPill} accessibilityLabel={t('create.workspace.savedHelp')}>
                            <View style={styles.savedDot} />
                            <SectionLabel style={styles.savedText}>{t('create.workspace.saved')}</SectionLabel>
                        </View>
                    </View>
                    <View style={styles.modelPill} accessibilityLabel={t('create.workspace.modelLabel', { name: modelLabel })}>
                        <SectionLabel style={styles.modelLive}>{t('create.livePrices')}</SectionLabel>
                        <Text variant="footnote" tone="primary" style={styles.modelName}>{modelLabel}</Text>
                        <SectionLabel style={styles.modelKind}>{modality}</SectionLabel>
                    </View>
                </View>

                {stage ?? <View style={styles.stage} accessibilityLabel={stageLine}>
                    <View style={styles.stageIconBox}>
                        <Icon name="play" size={28} tint={styles.accentInk.color} />
                    </View>
                    <Text variant="body" tone="primary" style={styles.stageTitle}>{stageLine}</Text>
                    <Text variant="footnote" tone="tertiary" style={styles.stageBody}>{t('create.workspace.stageHelp')}</Text>
                </View>}

    </>;
}
const sheets = themedStyles((p) => ({
    accentInk: { color: p.accent },
    hero: { gap: ds.space.md, marginBottom: ds.space.xxs },
    heroCopy: { flex: 1, gap: ds.space.xs },
    heroTop: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: ds.space.md },
    modelKind: { },
    modelLive: { },
    modelName: { color: p.textPrimary, flex: 1 },
    modelPill: { minHeight: MIN_TARGET, flexDirection: 'row', alignItems: 'center', gap: ds.space.sm, paddingHorizontal: ds.space.md, borderRadius: ds.radius.md, borderWidth: 1, borderColor: p.borderSubtle, backgroundColor: p.bgElevated1 },
    savedDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: p.accent },
    savedPill: { minHeight: MIN_TARGET, flexDirection: 'row', alignItems: 'center', gap: ds.space.sm, paddingHorizontal: ds.space.md, borderRadius: ds.radius.pill, borderWidth: 1, borderColor: p.borderSubtle, backgroundColor: p.bgElevated1 },
    savedText: { },
    stage: { minHeight: 210, alignItems: 'center', justifyContent: 'center', padding: ds.space.xl, borderRadius: ds.radius.lg, borderWidth: 1, borderColor: p.borderSubtle, backgroundColor: p.bgElevated1 },
    stageBody: { color: p.textTertiary, textAlign: 'center', marginTop: ds.space.sm, maxWidth: 300 },
    stageIconBox: { width: 66, height: 66, borderRadius: 33, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: p.borderStrong, backgroundColor: p.bg },
    stageTitle: { color: p.textPrimary, textAlign: 'center', marginTop: ds.space.lg },
    title: { color: p.textPrimary, },
}));
