import { MIN_TARGET } from '../../../lib/a11y';
import { themedStyles } from '../../../components/ui';

export const conversationStyles = themedStyles((p) => ({
    field: { flex: 1 },
    accentInk: { color: p.accent },
    screen: { flex: 1, backgroundColor: p.bg },
    center: { flex: 1 },
    messageList: { flex: 1 },
    conversationBar: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 14, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: p.borderSubtle, backgroundColor: p.bg },
    conversationTitle: { flex: 1, minWidth: 0 },
    threadTitle: { color: p.textPrimary },
    modelMeta: { color: p.textSecondary },
    headerControl: { minHeight: MIN_TARGET, justifyContent: 'center' },
    headerControlText: { color: p.textPrimary },
    moreControl: { width: MIN_TARGET, height: MIN_TARGET, alignItems: 'center', justifyContent: 'center' },
    renameBar: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: p.borderSubtle },
    renameInput: { minHeight: MIN_TARGET },
    list: { flexGrow: 1, paddingHorizontal: 16, paddingVertical: 18, gap: 20 },
    emptyList: { justifyContent: 'flex-start' },
    error: { color: p.danger, paddingHorizontal: 16, paddingBottom: 4 },
    notice: { color: p.textSecondary, paddingHorizontal: 16, paddingBottom: 4 },
    again: { alignSelf: 'flex-start', minHeight: MIN_TARGET, justifyContent: 'center' },
    composerDock: { paddingHorizontal: 12, paddingTop: 8, borderTopWidth: 1, borderTopColor: p.borderSubtle, backgroundColor: p.bg },
}));
