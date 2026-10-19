import { Stack } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView, Share, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { VEY_CLEARANCE } from '../../../components/VeyMascot';
import { touchTarget } from '../../../lib/a11y';
import { t } from '../../../lib/i18n';
import { EMPTY, MAX_ITEMS, THEMES, fetchSmartlink, publicUrl, saveSmartlink, slugFrom, smartlinkErrorKey, validateSmartlink, type LinkItem, type SmartLink } from '../../../lib/publishSmartlink';
import { usePublishApi } from '../../../lib/usePublishApi';
import { colors } from '../../../theme';

export default function SmartlinkScreen() {
    const api = usePublishApi();
    const [link, setLink] = useState<SmartLink | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [problem, setProblem] = useState<string | null>(null);
    const [notice, setNotice] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);

    const load = useCallback(async () => {
        try {
            setLink(await fetchSmartlink(api));
            setError(null);
        } catch (err) {
            setLink(null);
            setError(t(smartlinkErrorKey(err)));
        }
    }, [api]);

    useEffect(() => {
        setLink(null);
        void load();
    }, [load]);

    const set = (patch: Partial<SmartLink>) => setLink((l) => (l ? { ...l, ...patch } : l));
    const setItem = (i: number, patch: Partial<LinkItem>) => setLink((l) => (l ? { ...l, items: l.items.map((x, k) => (k === i ? { ...x, ...patch } : x)) } : l));

    async function save() {
        if (!link || busy) return;
        const invalid = validateSmartlink(link);
        if (invalid) {
            setProblem(t(invalid));
            return;
        }
        setBusy(true);
        setProblem(null);
        setNotice(null);
        try {
            await saveSmartlink(api, link);
            setNotice(t('smartlink.saved'));
            await load();
        } catch (err) {
            setProblem(t(smartlinkErrorKey(err)));
        } finally {
            setBusy(false);
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

    if (error && !link) return <View style={styles.screen}><Stack.Screen options={{ title: t('smartlink.title') }} /><Text style={styles.error} accessibilityRole="alert">{error}</Text></View>;
    if (!link) return <View style={styles.screen}><ActivityIndicator color={colors.accent} /></View>;
    const saved = link !== EMPTY && link.slug !== '';

    return (
        <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={90}>
            <Stack.Screen options={{ title: t('smartlink.title') }} />
            <ScrollView style={styles.flex} contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
                <Text style={styles.muted}>{t('smartlink.intro')}</Text>
                {saved ? <Text style={styles.muted}>{t('smartlink.totals', { views: link.views, clicks: link.clicks })}</Text> : null}
                <Text style={styles.label}>{t('smartlink.address')}</Text>
                <TextInput style={styles.input} value={link.slug} onChangeText={(v) => set({ slug: slugFrom(v) })} autoCapitalize="none" autoCorrect={false} maxLength={48} accessibilityLabel={t('smartlink.address')} placeholderTextColor={colors.muted} />
                <Text style={styles.label}>{t('smartlink.name')}</Text>
                <TextInput style={styles.input} value={link.title} onChangeText={(v) => set({ title: v })} maxLength={80} accessibilityLabel={t('smartlink.name')} placeholderTextColor={colors.muted} />
                <Text style={styles.label}>{t('smartlink.bio')}</Text>
                <TextInput style={[styles.input, styles.multi]} multiline value={link.bio} onChangeText={(v) => set({ bio: v })} maxLength={280} accessibilityLabel={t('smartlink.bio')} placeholderTextColor={colors.muted} />
                <Text style={styles.label}>{t('smartlink.avatar')}</Text>
                <TextInput style={styles.input} value={link.avatarUrl} onChangeText={(v) => set({ avatarUrl: v })} autoCapitalize="none" autoCorrect={false} keyboardType="url" accessibilityLabel={t('smartlink.avatar')} placeholderTextColor={colors.muted} />
                <Text style={styles.label} accessibilityRole="header">{t('smartlink.theme')}</Text>
                <View style={styles.chips}>
                    {THEMES.map((th) => (
                        <Pressable key={th} accessibilityRole="button" accessibilityState={{ selected: link.theme === th }} style={[styles.chip, touchTarget, link.theme === th && styles.chipOn]} onPress={() => set({ theme: th })}>
                            <Text style={[styles.chipText, link.theme === th && styles.chipTextOn]}>{t(`smartlink.theme.${th}`)}</Text>
                        </Pressable>
                    ))}
                </View>
                <Text style={styles.label} accessibilityRole="header">{t('smartlink.buttons')}</Text>
                {link.items.map((it, i) => (
                    <View key={it.id ?? `new-${i}`} style={styles.card}>
                        <TextInput style={styles.input} value={it.label} onChangeText={(v) => setItem(i, { label: v })} maxLength={60} placeholder={t('smartlink.itemLabel')} accessibilityLabel={t('smartlink.itemLabel')} placeholderTextColor={colors.muted} />
                        <TextInput style={styles.input} value={it.url} onChangeText={(v) => setItem(i, { url: v })} autoCapitalize="none" autoCorrect={false} keyboardType="url" placeholder="https://" accessibilityLabel={t('smartlink.itemUrl')} placeholderTextColor={colors.muted} />
                        <View style={styles.row}>
                            <Text style={styles.muted}>{t('smartlink.itemClicks', { count: it.clicks })}</Text>
                            <View style={styles.row}>
                                <Switch value={it.enabled} onValueChange={(v) => setItem(i, { enabled: v })} accessibilityLabel={t('smartlink.itemShown')} />
                                <Pressable accessibilityRole="button" accessibilityLabel={t('smartlink.removeItem', { label: it.label || String(i + 1) })} style={[styles.rm, touchTarget]} onPress={() => set({ items: link.items.filter((_, k) => k !== i) })}>
                                    <Text style={styles.rmText}>{t('smartlink.remove')}</Text>
                                </Pressable>
                            </View>
                        </View>
                    </View>
                ))}
                {link.items.length < MAX_ITEMS ? (
                    <Pressable accessibilityRole="button" style={[styles.add, touchTarget]} onPress={() => set({ items: [...link.items, { id: null, label: '', url: 'https://', enabled: true, clicks: 0 }] })}>
                        <Text style={styles.addText}>{t('smartlink.addItem')}</Text>
                    </Pressable>
                ) : null}
                <View style={styles.rowWide}>
                    <Text style={styles.label}>{t('smartlink.published')}</Text>
                    <Switch value={link.published} onValueChange={(v) => set({ published: v })} accessibilityLabel={t('smartlink.published')} />
                </View>
                <Text style={styles.muted}>{t('smartlink.publishedHint')}</Text>
                {problem ? <Text style={styles.error} accessibilityRole="alert">{problem}</Text> : null}
                {notice ? <Text style={styles.notice} accessibilityLiveRegion="polite">{notice}</Text> : null}
                <Pressable accessibilityRole="button" disabled={busy} accessibilityState={{ disabled: busy }} style={[styles.button, touchTarget, busy && styles.off]} onPress={save}>
                    {busy ? <ActivityIndicator color={colors.accentInk} /> : <Text style={styles.buttonText}>{t('smartlink.save')}</Text>}
                </Pressable>
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
    body: { padding: 16, paddingBottom: VEY_CLEARANCE, gap: 8 },
    label: { color: colors.text, fontSize: 14, fontWeight: '600', marginTop: 8 },
    input: { backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: 12, padding: 12, color: colors.text, fontSize: 16, minHeight: 48 },
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
