import { ActivityIndicator, View } from 'react-native';

import { t } from '../lib/i18n';
import { colors, ds } from '../theme';
import { themedStyles, useThemedStyles } from './ui';

export type LoadingSkeletonVariant = 'grid' | 'list' | 'form' | 'dashboard';

export function LoadingSkeleton({ label, variant }: { label?: string; variant: LoadingSkeletonVariant }) {
    const styles = useThemedStyles(sheets);
    const name = label ?? t('common.loading');
    return <View
        style={styles.wrap}
        accessible
        accessibilityRole="progressbar"
        accessibilityLabel={name}
        accessibilityState={{ busy: true }}
    >
        <View style={styles.indicator} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
            <ActivityIndicator size="small" color={colors.accent} />
        </View>
        <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
            {variant === 'grid' ? <GridSkeleton />
                : variant === 'list' ? <ListSkeleton />
                : variant === 'form' ? <FormSkeleton />
                : <DashboardSkeleton />}
        </View>
    </View>;
}

function GridSkeleton() {
    const styles = useThemedStyles(sheets);
    return <View style={styles.grid}>{Array.from({ length: 6 }, (_, index) => (
        <View key={index} style={styles.gridCard}><View style={styles.media} /><View style={styles.lineLong} /><View style={styles.lineShort} /></View>
    ))}</View>;
}

function ListSkeleton() {
    const styles = useThemedStyles(sheets);
    return <View style={styles.stack}>{Array.from({ length: 4 }, (_, index) => (
        <View key={index} style={styles.row}><View style={styles.thumb} /><View style={styles.copy}><View style={styles.lineLong} /><View style={styles.lineShort} /></View></View>
    ))}</View>;
}

function FormSkeleton() {
    const styles = useThemedStyles(sheets);
    return <View style={styles.stack}><View style={styles.titleLine} /><View style={styles.lineLong} />
        {Array.from({ length: 4 }, (_, index) => <View key={index} style={styles.formCard}><View style={styles.icon} /><View style={styles.copy}><View style={styles.lineLong} /><View style={styles.lineShort} /></View></View>)}
    </View>;
}

function DashboardSkeleton() {
    const styles = useThemedStyles(sheets);
    return <View style={styles.stack}><View style={styles.titleLine} /><View style={styles.lineShort} />
        <View style={styles.dashboardHero} />
        {Array.from({ length: 3 }, (_, index) => <View key={index} style={styles.dashboardRow} />)}
    </View>;
}

const sheets = themedStyles((p) => ({
    wrap: { position: 'relative', width: '100%', paddingHorizontal: ds.space.gutter, paddingVertical: ds.space.lg },
    indicator: { position: 'absolute', top: ds.space.lg, end: ds.space.gutter, zIndex: 1 },
    stack: { gap: ds.space.md },
    grid: { flexDirection: 'row', flexWrap: 'wrap', gap: ds.space.md },
    gridCard: { width: '47%', gap: ds.space.sm, paddingBottom: ds.space.sm },
    media: { width: '100%', aspectRatio: 0.82, borderRadius: ds.radius.md, backgroundColor: p.surface },
    row: { minHeight: 88, flexDirection: 'row', alignItems: 'center', gap: ds.space.md, padding: ds.space.md, borderRadius: ds.radius.md, backgroundColor: p.bgElevated1, borderWidth: 1, borderColor: p.borderSubtle },
    thumb: { width: 60, height: 60, borderRadius: ds.radius.sm, backgroundColor: p.surface },
    copy: { flex: 1, gap: ds.space.sm },
    formCard: { minHeight: 72, flexDirection: 'row', alignItems: 'center', gap: ds.space.md, padding: ds.space.md, borderRadius: ds.radius.md, backgroundColor: p.bgElevated1, borderWidth: 1, borderColor: p.borderSubtle },
    icon: { width: 44, height: 44, borderRadius: ds.radius.sm, backgroundColor: p.surface },
    dashboardHero: { height: 120, borderRadius: ds.radius.lg, backgroundColor: p.surface },
    dashboardRow: { height: 76, borderRadius: ds.radius.md, backgroundColor: p.bgElevated1, borderWidth: 1, borderColor: p.borderSubtle },
    titleLine: { width: '52%', height: 26, borderRadius: ds.radius.xs, backgroundColor: p.surfacePressed },
    lineLong: { width: '72%', height: 12, borderRadius: ds.radius.xs, backgroundColor: p.surfacePressed },
    lineShort: { width: '42%', height: 10, borderRadius: ds.radius.xs, backgroundColor: p.borderSubtle },
}));
