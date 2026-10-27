import { Text, Button, Card, Icon, themedStyles, useThemedStyles } from './ui';
import { StyleSheet, View } from 'react-native';

import { plural, t } from '../lib/i18n';
import { expiryOf, rowStatus } from '../lib/libraryView';
import type { Job, Kind } from '../lib/media';
import { ds } from '../theme';

interface Props {
    readonly job: Job;
    readonly name: string;
    readonly kind: Kind | undefined;
    readonly grid: boolean;
    readonly starred: boolean;
    readonly canSchedule: boolean;
    readonly canReuse: boolean;
    readonly onOpen: () => void;
    readonly onStar: () => void;
    readonly onSchedule: () => void;
    readonly onReuse: () => void;
}

// One creation in the Library: what it is, its state, its price, when its file goes, and the actions that apply.
// A failed job says how many credits came back; a file near the end of its life says when.
export function LibraryItem({ job, name, kind, grid, starred, canSchedule, canReuse, onOpen, onStar, onSchedule, onReuse }: Props) {
    const styles = useThemedStyles(sheets);
    const status = rowStatus(job);
    const expiry = expiryOf(job);
    const when = new Date(job.created_at).toLocaleDateString();
    const cost = job.credits > 0 ? plural('library.cost', job.credits) : t('library.costFree');
    const statusText =
        status === 'refunded' ? (job.credits > 0 ? plural('library.refunded', job.credits) : t('library.refundedFree')) : t(`library.status.${status}`);
    const expiryText = expiry.kind === 'on' ? t('library.expires', { date: expiry.date.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) }) : expiry.kind === 'gone' ? t('library.expired') : null;
    const bad = status === 'refunded' || status === 'failed';

    return (
        <Card style={[styles.card, grid ? styles.gridCard : styles.listRow]}>
            <Card accessibilityRole="button" accessibilityLabel={[name, statusText, cost, when, expiryText].filter(Boolean).join(', ')} style={styles.main} onPress={onOpen}>
                {kind ? <Icon name={kind} size={grid ? 28 : 24} /> : null}
                <Text variant="bodyStrong" tone="primary" style={styles.name} numberOfLines={grid ? 2 : 1}>{name}</Text>
                <Text variant="body" tone="accent" style={[styles.status, bad && styles.statusBad]}>{statusText}</Text>
                <Text variant="footnote" tone="tertiary"><Text variant="footnote" tone="warning">{cost}</Text>{` · ${when}`}</Text>
                {expiryText ? <Text variant="footnote" tone="tertiary" style={[styles.muted, expiry.kind === 'gone' && styles.statusBad]}>{expiryText}</Text> : null}
            </Card>
            <View style={styles.actions}>
                <Button variant="tertiary" accessibilityRole="button" accessibilityLabel={t('library.favouriteLabel', { name })} accessibilityState={{ selected: starred }} onPress={onStar} label={t('library.favouriteLabel', { name })} icon={starred ? 'starFill' : 'star'} iconOnly />
                {canSchedule ? (
                    <Button variant="secondary" accessibilityRole="button" accessibilityLabel={t('library.scheduleLabel', { name })} onPress={onSchedule} label={t('library.schedule')} />
                ) : null}
                {canReuse ? (
                    <Button variant="secondary" accessibilityRole="button" accessibilityLabel={t('library.reuseLabel', { name })} onPress={onReuse} label={t('library.reuse')} />
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
    name: { color: p.textPrimary, },
    status: { color: p.accent, },
    statusBad: { color: p.danger },
    muted: { color: p.textTertiary, },
    actions: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: ds.space.sm },
}));
