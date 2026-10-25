import { Pressable, StyleSheet, Text, View } from 'react-native';
import { touchTarget } from '../lib/a11y';
import { plural, t } from '../lib/i18n';
import { expiryOf, rowStatus } from '../lib/libraryView';
import type { Job, Kind } from '../lib/media';
import { colors } from '../theme';

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

const GLYPH: Record<Kind, string> = { image: '▣', video: '▶', audio: '♪' };

// One creation in the Library: what it is, its state, its price, when its file goes, and the actions that apply.
// A failed job says how many credits came back; a file near the end of its life says when.
export function LibraryItem({ job, name, kind, grid, starred, canSchedule, canReuse, onOpen, onStar, onSchedule, onReuse }: Props) {
    const status = rowStatus(job);
    const expiry = expiryOf(job);
    const when = new Date(job.created_at).toLocaleDateString();
    const cost = job.credits > 0 ? plural('library.cost', job.credits) : t('library.costFree');
    const statusText =
        status === 'refunded' ? (job.credits > 0 ? plural('library.refunded', job.credits) : t('library.refundedFree')) : t(`library.status.${status}`);
    const expiryText = expiry.kind === 'on' ? t('library.expires', { date: expiry.date.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) }) : expiry.kind === 'gone' ? t('library.expired') : null;
    const bad = status === 'refunded' || status === 'failed';

    return (
        <View style={[styles.card, grid && styles.gridCard]}>
            <Pressable accessibilityRole="button" accessibilityLabel={[name, statusText, cost, when, expiryText].filter(Boolean).join(', ')} style={styles.main} onPress={onOpen}>
                {kind ? <Text style={[styles.glyph, grid && styles.glyphGrid]} accessibilityElementsHidden importantForAccessibility="no">{GLYPH[kind]}</Text> : null}
                <Text style={styles.name} numberOfLines={grid ? 2 : 1}>{name}</Text>
                <Text style={[styles.status, bad && styles.statusBad]}>{statusText}</Text>
                <Text style={styles.muted}>{`${cost} · ${when}`}</Text>
                {expiryText ? <Text style={[styles.muted, expiry.kind === 'gone' && styles.statusBad]}>{expiryText}</Text> : null}
            </Pressable>
            <View style={styles.actions}>
                <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={t('library.favouriteLabel', { name })}
                    accessibilityState={{ selected: starred }}
                    style={[styles.star, touchTarget]}
                    onPress={onStar}
                >
                    <Text style={[styles.starText, starred && styles.starOn]}>{starred ? '★' : '☆'}</Text>
                </Pressable>
                {canSchedule ? (
                    <Pressable accessibilityRole="button" accessibilityLabel={t('library.scheduleLabel', { name })} style={[styles.schedule, touchTarget]} onPress={onSchedule}>
                        <Text style={styles.scheduleText}>{t('library.schedule')}</Text>
                    </Pressable>
                ) : null}
                {canReuse ? (
                    <Pressable accessibilityRole="button" accessibilityLabel={t('library.reuseLabel', { name })} style={[styles.schedule, touchTarget]} onPress={onReuse}>
                        <Text style={styles.scheduleText}>{t('library.reuse')}</Text>
                    </Pressable>
                ) : null}
            </View>
        </View>
    );
}

const styles = StyleSheet.create({
    card: { paddingVertical: 12, borderBottomColor: colors.border, borderBottomWidth: StyleSheet.hairlineWidth, gap: 6 },
    gridCard: { flex: 1, margin: 4, padding: 12, backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: 12 },
    main: { gap: 3, minHeight: 44 },
    glyph: { color: colors.muted, fontSize: 16 },
    glyphGrid: { fontSize: 28 },
    name: { color: colors.text, fontSize: 16 },
    status: { color: colors.accent, fontWeight: '600' },
    statusBad: { color: colors.danger },
    muted: { color: colors.muted, fontSize: 13 },
    actions: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 },
    star: { minWidth: 44, alignItems: 'center' },
    starText: { color: colors.muted, fontSize: 22 },
    starOn: { color: colors.money },
    schedule: { paddingHorizontal: 12, borderRadius: 10, borderColor: colors.border, borderWidth: 1 },
    scheduleText: { color: colors.accent, fontWeight: '600' },
});
