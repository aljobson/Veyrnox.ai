import { subscribeCacheUser } from '../../../lib/appCache';
import { brandStore } from '../../../lib/publishBrand';
import { publishScope, usePublishRole } from '../../../lib/usePublishRole';
import { canPublish } from '../../../lib/publishDashboard';
import { Text as StatusText } from '../../../components/ui/Text';
import { Stack } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView, Share, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { touchTarget } from '../../../lib/a11y';
import { t } from '../../../lib/i18n';
import { EMPTY, MAX_ITEMS, THEMES, fetchSmartlink, publicUrl, saveSmartlink, slugFrom, smartlinkErrorKey, validateSmartlink, type LinkItem, type SmartLink } from '../../../lib/publishSmartlink';
import { usePublishApi } from '../../../lib/usePublishApi';
import { colors, LIST_END_PADDING } from '../../../theme';

export default function SmartlinkScreen() {
    const api = usePublishApi();
    const role = usePublishRole(api);
    const canWrite = role !== null && canPublish(role);
    const canWriteRef = useRef(canWrite); canWriteRef.current = canWrite;
    const generation = useRef(0), currentApi = useRef(api), running = useRef(false);
    currentApi.current = api;
    const [scopeTick, setScopeTick] = useState(0);
    function guard() {
        const version = generation.current, scope = publishScope();
        return () => version === generation.current && scope === publishScope() && currentApi.current === api;
    }
    useEffect(() => {
        const reset = () => {
            generation.current++; canWriteRef.current = false; running.current = false;
            setLink(null); setError(null); setProblem(null); setNotice(null); setBusy(false);
            setScopeTick(n => n + 1);
        };
        const userOff = subscribeCacheUser(reset), brandOff = brandStore.subscribe(reset);
        return () => { generation.current++; canWriteRef.current = false; userOff(); brandOff(); };
    }, []);

    const [link, setLink] = useState<SmartLink | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [problem, setProblem] = useState<string | null>(null);
    const [notice, setNotice] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);

    const load = useCallback(async () => {
        const valid = guard();
        try {
            const next = await fetchSmartlink(api);
            if (!valid()) return;
            setLink(next);
            setError(null);
        } catch (err) {
            if (!valid()) return;
            setLink(null);
            setError(t(smartlinkErrorKey(err)));
        }
    }, [api, scopeTick]);

    useEffect(() => {
        setLink(null);
        void load();
    }, [load]);

    const set = (patch: Partial<SmartLink>) => setLink((l) => (l ? { ...l, ...patch } : l));
    const setItem = (i: number, patch: Partial<LinkItem>) => setLink((l) => (l ? { ...l, items: l.items.map((x, k) => (k === i ? { ...x, ...patch } : x)) } : l));

    async function save() {
        if (!link || running.current || !canWriteRef.current) return;
        const valid = guard();
        const invalid = validateSmartlink(link);
        if (invalid) {
            setProblem(t(invalid));
            return;
        }
        running.current = true; setBusy(true);
        setProblem(null);
        setNotice(null);
        try {
            await saveSmartlink(api, link);
            if (valid()) { setNotice(t('smartlink.saved')); await load(); }
        } catch (err) {
            if (valid()) setProblem(t(smartlinkErrorKey(err)));
        } finally {
            if (valid()) { running.current = false; setBusy(false); }
        }
    }

    async function share() {
        if (!link?.slug) return;
        try {
            await Share.share({ message: publicUrl(link.slug) });
        } catch {
            setNotice(t('smartlink.shareFailed'));
        }
    }

    if (error && !link) return <View style={styles.screen}><Stack.Screen options={{ title: t('smartlink.title') }} /><StatusText variant="inherit" style={styles.error} accessibilityRole="alert">{error}</StatusText></View>;
    if (!link) return <View style={styles.screen}><ActivityIndicator color={colors.accent} /></View>;
    const saved = link !== EMPTY && link.slug !== '';

    return (
        <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={90}>
            <Stack.Screen options={{ title: t('smartlink.title') }} />
            <ScrollView style={styles.flex} contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
            {!canWrite ? <Text style={styles.muted}>{t('publishOps.readOnly')}</Text> : null}

                <Text style={styles.muted}>{t('smartlink.intro')}</Text>
                {saved ? <Text style={styles.muted}>{t('smartlink.totals', { views: link.views, clicks: link.clicks })}</Text> : null}
                <Text style={styles.label}>{t('smartlink.address')}</Text>
                <TextInput editable={canWrite && !busy} style={styles.input} value={link.slug} onChangeText={(v) => set({ slug: slugFrom(v) })} autoCapitalize="none" autoCorrect={false} maxLength={48} accessibilityLabel={t('smartlink.address')} placeholderTextColor={colors.muted} />
                <Text style={styles.label}>{t('smartlink.name')}</Text>
                <TextInput editable={canWrite && !busy} style={styles.input} value={link.title} onChangeText={(v) => set({ title: v })} maxLength={80} accessibilityLabel={t('smartlink.name')} placeholderTextColor={colors.muted} />
                <Text style={styles.label}>{t('smartlink.bio')}</Text>
                <TextInput editable={canWrite && !busy} style={[styles.input, styles.multi]} multiline value={link.bio} onChangeText={(v) => set({ bio: v })} maxLength={280} accessibilityLabel={t('smartlink.bio')} placeholderTextColor={colors.muted} />
                <Text style={styles.label}>{t('smartlink.avatar')}</Text>
                <TextInput editable={canWrite && !busy} style={styles.input} value={link.avatarUrl} onChangeText={(v) => set({ avatarUrl: v })} autoCapitalize="none" autoCorrect={false} keyboardType="url" accessibilityLabel={t('smartlink.avatar')} placeholderTextColor={colors.muted} />
                <Text style={styles.label} accessibilityRole="header">{t('smartlink.theme')}</Text>
                <View style={styles.chips}>
                    {THEMES.map((th) => (
                        <Pressable disabled={!canWrite || busy} key={th} accessibilityRole="button" accessibilityState={{ selected: link.theme === th }} style={[styles.chip, touchTarget, link.theme === th && styles.chipOn]} onPress={() => set({ theme: th })}>
                            <Text style={[styles.chipText, link.theme === th && styles.chipTextOn]}>{t(`smartlink.theme.${th}`)}</Text>
                        </Pressable>
                    ))}
                </View>
                <Text style={styles.label} accessibilityRole="header">{t('smartlink.buttons')}</Text>
                {link.items.map((it, i) => (
                    <View key={it.id ?? `new-${i}`} style={styles.card}>
                        <TextInput editable={canWrite && !busy} style={styles.input} value={it.label} onChangeText={(v) => setItem(i, { label: v })} maxLength={60} placeholder={t('smartlink.itemLabel')} accessibilityLabel={t('smartlink.itemLabel')} placeholderTextColor={colors.muted} />
                        <TextInput editable={canWrite && !busy} style={styles.input} value={it.url} onChangeText={(v) => setItem(i, { url: v })} autoCapitalize="none" autoCorrect={false} keyboardType="url" placeholder={t('publish.https')} accessibilityLabel={t('smartlink.itemUrl')} placeholderTextColor={colors.muted} />
                        <View style={styles.row}>
                            <Text style={styles.muted}>{t('smartlink.itemClicks', { count: it.clicks })}</Text>
                            <View style={styles.row}>
                                <Switch disabled={!canWrite || busy} value={it.enabled} onValueChange={(v) => setItem(i, { enabled: v })} accessibilityLabel={t('smartlink.itemShown')} />
                                {canWrite ? <Pressable disabled={busy} accessibilityRole="button" accessibilityLabel={t('smartlink.removeItem', { label: it.label || String(i + 1) })} style={[styles.rm, touchTarget]} onPress={() => set({ items: link.items.filter((_, k) => k !== i) })}>
                                    <Text style={styles.rmText}>{t('smartlink.remove')}</Text>
                                </Pressable> : null}
                            </View>
                        </View>
                    </View>
                ))}
                {canWrite && link.items.length < MAX_ITEMS ? (
                    <Pressable disabled={busy} accessibilityRole="button" style={[styles.add, touchTarget]} onPress={() => set({ items: [...link.items, { id: null, label: '', url: 'https://', enabled: true, clicks: 0 }] })}>
                        <Text style={styles.addText}>{t('smartlink.addItem')}</Text>
                    </Pressable>
                ) : null}
                <View style={styles.rowWide}>
                    <Text style={styles.label}>{t('smartlink.published')}</Text>
                    <Switch disabled={!canWrite || busy} value={link.published} onValueChange={(v) => set({ published: v })} accessibilityLabel={t('smartlink.published')} />
                </View>
                <Text style={styles.muted}>{t('smartlink.publishedHint')}</Text>
                {problem ? <StatusText variant="inherit" style={styles.error} accessibilityRole="alert">{problem}</StatusText> : null}
                {notice ? <StatusText variant="inherit" style={styles.notice} accessibilityLiveRegion="polite">{notice}</StatusText> : null}
                {canWrite ? <Pressable accessibilityRole="button" disabled={busy} accessibilityState={{ disabled: busy }} style={[styles.button, touchTarget, busy && styles.off]} onPress={save}>
                    {busy ? <ActivityIndicator color={colors.accentInk} /> : <Text style={styles.buttonText}>{t('smartlink.save')}</Text>}
                </Pressable> : null}
                {saved && link.published ? (
                    <Pressable accessibilityRole="button" style={[styles.add, touchTarget]} onPress={share}>
                        <Text style={styles.addText}>{t('smartlink.share')}</Text>
                    </Pressable>
                ) : null}
            </ScrollView>
        </KeyboardAvoidingView>
    );
}

const styles = StyleSheet.create({
    flex: { flex: 1, backgroundColor: colors.background },
    screen: { flex: 1, backgroundColor: colors.background, padding: 16 },
    body: { padding: 16, paddingBottom: LIST_END_PADDING, gap: 8 },
    label: { color: colors.text, fontSize: 14, fontWeight: '600', marginTop: 8 },
    input: { backgroundColor: colors.surface, borderColor: colors.borderStrong, borderWidth: 1, borderRadius: 12, padding: 12, color: colors.text, fontSize: 16, minHeight: 48 },
    multi: { minHeight: 80 },
    muted: { color: colors.muted, fontSize: 13 },
    card: { backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: 12, padding: 10, gap: 8 },
    row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    rowWide: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    chip: { paddingHorizontal: 12, borderRadius: 10, backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1 },
    chipOn: { backgroundColor: colors.accent, borderColor: colors.accent },
    chipText: { color: colors.body },
    chipTextOn: { color: colors.accentInk, fontWeight: '600' },
    rm: { paddingHorizontal: 8 },
    rmText: { color: colors.danger, fontWeight: '600' },
    add: { alignItems: 'center', backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: 12 },
    addText: { color: colors.accent, fontSize: 16, fontWeight: '600' },
    button: { backgroundColor: colors.accent, borderRadius: 12, alignItems: 'center', paddingVertical: 14, marginTop: 8 },
    off: { opacity: 0.4 },
    buttonText: { color: colors.accentInk, fontWeight: '700', fontSize: 16 },
    error: { color: colors.danger },
    notice: { color: colors.accent },
});
