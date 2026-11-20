import { themedStyles } from '../ui';
import { ds } from '../../theme';
export const pianoStyles = themedStyles(p => ({
    screen: { flex: 1, backgroundColor: p.bg },
    content: { padding: ds.space.gutter, paddingBottom: ds.space.hero, gap: ds.space.md },
    section: { gap: ds.space.sm },
    row: { flexDirection: 'row', flexWrap: 'wrap', gap: ds.space.sm, alignItems: 'center' },
    field: { minHeight: 44, minWidth: 100, borderWidth: 1, borderColor: p.borderSubtle, borderRadius: ds.radius.sm, color: p.textPrimary, padding: ds.space.sm },
    key: { minWidth: 44, height: 120, borderWidth: 1, borderColor: p.borderSubtle, backgroundColor: p.bgElevated1, justifyContent: 'flex-end', alignItems: 'center', paddingBottom: 12 },
    black: { backgroundColor: p.textPrimary },
    blackText: { color: p.bg },
    gridRow: { borderBottomWidth: 1, borderColor: p.borderSubtle },
    cRow: { backgroundColor: p.bgElevated1 },
    gridLine: { position: 'absolute', top: 0, bottom: 0, width: 1, backgroundColor: p.borderSubtle },
    barLine: { backgroundColor: p.textPrimary, width: 2 },
    note: { position: 'absolute', backgroundColor: p.accent, borderWidth: 1, borderColor: p.borderSubtle, borderRadius: 4, overflow: 'hidden' },
    selected: { borderWidth: 3, borderColor: p.textPrimary },
    preview: { backgroundColor: p.accent },
}));
