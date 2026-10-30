import { themedStyles } from '../ui';
import { ds } from '../../theme';
import { MIN_TARGET } from '../../lib/a11y';

export const createFormSheets = themedStyles((p) => ({
    accentInk: { color: p.accent },
    mutedInk: { color: p.textTertiary },

    screen: { flex: 1, backgroundColor: p.bg },
    body: { padding: ds.space.lg, paddingBottom: 48, gap: ds.space.md },
    section: { gap: ds.space.sm },
    settingsSection: { gap: ds.space.md, marginTop: ds.space.xxs },
    sectionTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: ds.space.md },
    sectionLabel: { },
    sectionMeta: { },
    topic: { minHeight: 90 },
    prompt: { minHeight: 126, textAlignVertical: 'top' },
    skillsRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: ds.space.xs },
    skillsIntro: { color: p.textTertiary, },
    chips: { flexDirection: 'row', gap: ds.space.sm },
    short: { backgroundColor: p.bgElevated1, borderColor: p.warning, borderWidth: 1, borderRadius: ds.radius.md, padding: ds.space.md, gap: ds.space.xs },
    shortText: { color: p.warning, fontVariant: ['tabular-nums'], },
    restored: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: ds.space.md, backgroundColor: p.bgElevated1, borderColor: p.borderSubtle, borderWidth: 1, borderRadius: ds.radius.md, paddingStart: ds.space.md },
    restoredText: { color: p.textSecondary, flexShrink: 1 },
    consent: { color: p.textTertiary, },
    rightsBox: { gap: ds.space.sm },
    rightsControl: { minHeight: MIN_TARGET, justifyContent: 'center', borderWidth: 1, borderColor: p.borderStrong, borderRadius: ds.radius.md, padding: ds.space.md, backgroundColor: p.bgElevated1 },
    rightsText: { color: p.textSecondary, },
    costCard: { gap: ds.space.md, padding: ds.space.lg, borderRadius: ds.radius.lg, borderWidth: 1, borderColor: p.borderSubtle, backgroundColor: p.bgElevated1 },
    costTop: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: ds.space.md },
    cost: { marginTop: ds.space.xs, color: p.warning, fontVariant: ['tabular-nums'], },
    balance: { color: p.textSecondary, fontVariant: ['tabular-nums'], },
    refund: { textAlign: 'center' },
    terms: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'center' },
    error: { color: p.danger },
}));
