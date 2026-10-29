import { rawText } from '../lib/i18n/translate';
import { Text, Button, Card, themedStyles, useThemedStyles } from './ui';
import { StyleSheet, View } from 'react-native';

import { formatLocale, plural, t } from '../lib/i18n';
import { retentionOf, rowStatus } from '../lib/libraryView';
import type { Job, Kind } from '../lib/media';
import { LibraryMedia, type LibraryMediaProps } from './library/LibraryMedia';
import { ds } from '../theme';

interface Props {
    readonly job: Job;
    readonly retentionKnown: boolean;
    readonly now: number;
    readonly media?: Omit<LibraryMediaProps, 'job' | 'kind'>;
    readonly name: string;
    readonly kind: Kind | undefined;
    readonly grid: boolean;
    readonly starred: boolean;
    readonly canSchedule: boolean;
    readonly canAsk?: boolean;
    readonly onAsk?: () => void;
    readonly canReuse: boolean;
    readonly onOpen: () => void;
    readonly onStar: () => void;
    readonly onSchedule: () => void;
    readonly onReuse: () => void;
}

// One creation in the Library: what it is, its state, its price, when its file goes, and the actions that apply.
// A failed job says how many credits came back; a file near the end of its life says when.
export function LibraryItem({ job, retentionKnown, now, name, kind, grid, starred, canSchedule, canReuse, canAsk, onAsk, onOpen, onStar, onSchedule, onReuse, media }: Props) {
    const styles = useThemedStyles(sheets);
    const status = rowStatus(job);
    const retention = retentionKnown ? retentionOf(job, now) : { kind: 'none' } as const;
    const when = new Date(job.created_at).toLocaleDateString(formatLocale());
    const cost = job.credits > 0 ? plural('library.cost', job.credits) : t('library.costFree');
    const statusText =
        status === 'refunded' ? (job.credits > 0 ? plural('library.refunded', job.credits) : t('library.refundedFree')) : t(`library.status.${status}`);
    const retentionText = retention.kind === 'unavailable' ? t('library.fileUnavailable')
        : retention.kind === 'default' ? t('library.keptDefault')
        : retention.kind === 'expires' || retention.kind === 'ended'
            ? t(retention.kind === 'ended' ? 'library.retentionEnded' : 'library.expires', {
                date: retention.date.toLocaleDateString(formatLocale(), { day: 'numeric', month: 'short', year: 'numeric' }),
            }) : null;
    const urgent = retention.kind === 'ended' || (retention.kind === 'expires' && retention.urgent);
    const bad = status === 'refunded' || status === 'failed';

    return (
        <Card style={[styles.card, grid ? styles.gridCard : styles.listRow]}>
            <Card accessibilityRole="button" accessibilityLabel={rawText([name, statusText, cost, when, retentionText].filter(Boolean).join(', '))} style={[styles.main, !grid && styles.horizontal]} onPress={onOpen}>
                <View style={grid ? styles.square : styles.thumbnail}>
                    <LibraryMedia job={job} kind={kind} {...media} />
                    {grid ? <View style={styles.statusChip}><Text variant="caption" tone={bad ? 'danger' : 'accent'}>{statusText}</Text></View> : null}
                </View>
                <View style={styles.copy}>
                <Text variant="bodyStrong" tone="primary" style={styles.name} numberOfLines={grid ? 2 : 1}>{name}</Text>
                {!grid ? <Text variant="body" tone="accent" style={[styles.status, bad && styles.statusBad]}>{statusText}</Text> : null}
                <Text variant="footnote" tone="tertiary">{t('libraryCreate.costDate', { cost, date: when })}</Text>
                {retentionText ? <Text variant="footnote" tone={urgent ? 'danger' : 'tertiary'}>{retentionText}</Text> : null}
                </View>
            </Card>
            <View style={styles.actions}>
                <Button variant="tertiary" accessibilityRole="button" accessibilityLabel={rawText(t('library.favouriteLabel', { name }))} accessibilityState={{ selected: starred }} onPress={onStar} label={t('library.favouriteLabel', { name })} icon={starred ? 'starFill' : 'star'} iconOnly />
                {canSchedule ? (
                    <Button variant="secondary" accessibilityRole="button" accessibilityLabel={rawText(t('library.scheduleLabel', { name }))} onPress={onSchedule} label={t('library.schedule')} />
                ) : null}
                {canAsk ? <Button variant="secondary" label={t('chatDepth.ask')} accessibilityLabel={rawText(t('chatDepth.askLabel', { name }))} onPress={onAsk} /> : null}
                {canReuse ? (
                    <Button variant="secondary" accessibilityRole="button" accessibilityLabel={rawText(t('library.reuseLabel', { name }))} onPress={onReuse} label={t('library.reuse')} />
                ) : null}
            </View>
        </Card>
    );
}

const sheets = themedStyles((p) => ({

    card: { paddingVertical: ds.space.md, borderBottomColor: p.borderSubtle, borderBottomWidth: StyleSheet.hairlineWidth, gap: ds.space.sm },
    listRow: { borderWidth: 0, borderBottomWidth: StyleSheet.hairlineWidth, boxShadow: 'none', borderRadius: 0, paddingHorizontal: 0, backgroundColor: p.bg },
    gridCard: { flex: 1, margin: ds.space.xs, padding: ds.space.md, backgroundColor: p.bgElevated1, borderColor: p.borderSubtle, borderWidth: 1, borderRadius: ds.radius.md },
    main: { padding: 0, borderWidth: 0, borderRadius: 0, backgroundColor: 'transparent', boxShadow: 'none', gap: ds.space.xs, minHeight: 44 },
    square: { width: '100%', aspectRatio: 1 },
    thumbnail: { width: 72, height: 72 },
    horizontal: { flexDirection: 'row' },
    copy: { flex: 1, gap: ds.space.xs },
    statusChip: { position: 'absolute', top: 4, start: 4, borderRadius: 8, padding: 4, backgroundColor: p.bgElevated1 },
    name: { color: p.textPrimary, },
    status: { color: p.accent, },
    statusBad: { color: p.danger },
    muted: { color: p.textTertiary, },
    actions: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: ds.space.sm },
}));
