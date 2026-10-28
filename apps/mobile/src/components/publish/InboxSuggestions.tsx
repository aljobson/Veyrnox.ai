import { Text as StatusText } from '../ui/Text';
import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { touchTarget } from '../../lib/a11y';
import type { ApiClient } from '../../lib/api';
import { subscribeCacheUser } from '../../lib/appCache';
import { brandStore, type BrandRole } from '../../lib/publishBrand';
import { decideSuggestion, inboxScope, type Suggestion } from '../../lib/publishInbox';
import { t } from '../../lib/i18n';
import { colors } from '../../theme';

export function InboxSuggestions({ api, threadId, rows, role, canReply, pendingReply, onUse, onRemove }: {
    api: ApiClient; threadId: string; rows: Suggestion[]; role: BrandRole; canReply: boolean; pendingReply: boolean;
    onUse: (text: string) => void; onRemove: (id: string) => void;
}) {
    const [busy, setBusy] = useState(false), [error, setError] = useState(false);
    const generation = useRef(0), running = useRef(false);
    const latest = useRef({ pendingReply, onUse, onRemove }); latest.current = { pendingReply, onUse, onRemove };
    useEffect(() => {
        const clear = () => { generation.current++; running.current = false; setBusy(false); setError(false); };
        clear(); const userOff = subscribeCacheUser(clear), brandOff = brandStore.subscribe(clear);
        return () => { generation.current++; userOff(); brandOff(); };
    }, [api, threadId]);
    const allowed = ['owner', 'manager', 'editor'].includes(role);
    async function decide(row: Suggestion, action: 'use' | 'dismiss') {
        if (running.current || !allowed || (action === 'use' && (!canReply || latest.current.pendingReply))) return;
        const token = inboxScope(), version = generation.current;
        const valid = () => token === inboxScope() && version === generation.current;
        running.current = true; setBusy(true); setError(false);
        try {
            const result = await decideSuggestion(api, threadId, row.id, action);
            if (!valid()) return;
            if (action === 'use' && !latest.current.pendingReply) latest.current.onUse(result.suggestedReply || row.text);
            latest.current.onRemove(row.id);
        } catch { if (valid()) setError(true); }
        finally { if (valid()) { running.current = false; setBusy(false); } }
    }
    if (!rows.length) return null;
    return <View style={styles.list} accessibilityState={{ busy }}>
        <Text accessibilityRole="header" style={styles.text}>{t('publishDepth.suggestions.title')}</Text>
        <Text style={styles.muted}>{t('publishDepth.suggestions.intro')}</Text>
        {error ? <StatusText variant="inherit" style={styles.error} accessibilityRole="alert">{t('publishDepth.suggestions.failed')}</StatusText> : null}
        {pendingReply && allowed && canReply ? <Text style={styles.muted}>{t('publishDepth.suggestions.pendingReply')}</Text> : null}
        {rows.map(row => <View key={row.id} style={styles.card}>
            <View style={styles.source}><Text style={styles.muted}>{row.workflowName}</Text><Text style={[styles.muted, styles.keyword]}>{row.keyword}</Text></View><Text style={styles.text}>{row.text}</Text>
            {allowed ? <View style={styles.actions}>
                {canReply ? <Pressable style={touchTarget} accessibilityRole="button" accessibilityState={{ busy, disabled: busy || pendingReply }} disabled={busy || pendingReply} onPress={() => decide(row, 'use')}><Text style={styles.action}>{t('publishDepth.suggestions.use')}</Text></Pressable> : null}
                <Pressable style={touchTarget} accessibilityRole="button" accessibilityState={{ busy, disabled: busy }} disabled={busy} onPress={() => decide(row, 'dismiss')}><Text style={styles.action}>{t('publishDepth.suggestions.dismiss')}</Text></Pressable>
            </View> : null}
        </View>)}
    </View>;
}
const styles = StyleSheet.create({ list: { gap: 8 }, card: { padding: 12, gap: 6, backgroundColor: colors.surface, borderRadius: 12 }, actions: { flexDirection: 'row', gap: 20 }, text: { color: colors.text }, muted: { color: colors.muted }, action: { color: colors.accent }, error: { color: colors.danger }, source: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 }, keyword: { fontStyle: 'italic' } });
