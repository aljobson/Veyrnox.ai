import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { UnlockCard } from '../../../components/UnlockCard';
import { dateText, timeText, WhenPicker, whenFrom } from '../../../components/WhenPicker';
import { touchTarget } from '../../../lib/a11y';
import { ApiError } from '../../../lib/api';
import { t } from '../../../lib/i18n';
import { fetchPosts, type PublishPost } from '../../../lib/publish';
import {
    adsErrorKey, buildCampaignBody, emptyForm, fetchCampaignPage, formFromCampaign, saveCampaign,
    MODES, NETWORKS, OBJECTIVES, type CampaignForm,
} from '../../../lib/publishAds';
import { usePublishApi } from '../../../lib/usePublishApi';
import { colors } from '../../../theme';

const BOOST_CHOICES = 20;

// ADR-0228: a draft campaign is a saved form. Nothing here buys an ad, reaches an ad network or spends money.
export default function AdsEdit() {
    const api = usePublishApi();
    const router = useRouter();
    const { id } = useLocalSearchParams<{ id?: string }>();
    const [form, setForm] = useState<CampaignForm>(emptyForm());
    const [startDate, setStartDate] = useState('');
    const [startTime, setStartTime] = useState('09:00');
    const [endDate, setEndDate] = useState('');
    const [endTime, setEndTime] = useState('09:00');
    const [posts, setPosts] = useState<PublishPost[]>([]);
    const [ready, setReady] = useState(false);
    const [locked, setLocked] = useState(false);
    const [canEdit, setCanEdit] = useState(true);
    const [busy, setBusy] = useState(false);
    const [problem, setProblem] = useState<string | null>(null);
    const [reload, setReload] = useState(0);

    useEffect(() => {
        let cancelled = false;
        Promise.all([fetchCampaignPage(api), fetchPosts(api).catch(() => [] as PublishPost[])])
            .then(([page, recent]) => {
                if (cancelled) return;
                setCanEdit(page.canEdit);
                setPosts(recent.filter((p) => p.status === 'published').slice(0, BOOST_CHOICES));
                const found = id ? page.campaigns.find((c) => c.id === id) : undefined;
                if (found) {
                    setForm(formFromCampaign(found));
                    if (found.startsAt) { const d = new Date(found.startsAt); setStartDate(dateText(d)); setStartTime(timeText(d)); }
                    if (found.endsAt) { const d = new Date(found.endsAt); setEndDate(dateText(d)); setEndTime(timeText(d)); }
                } else if (id) {
                    setProblem(t('ads.err.later'));
                }
                setLocked(false);
                setReady(true);
            })
            .catch((err) => {
                if (cancelled) return;
                if (err instanceof ApiError && err.status === 402) setLocked(true);
                else setProblem(t(adsErrorKey(err)));
                setReady(true);
            });
        return () => { cancelled = true; };
    }, [api, id, reload]);

    const set = <K extends keyof CampaignForm>(key: K, value: CampaignForm[K]) => setForm((f) => ({ ...f, [key]: value }));

    async function save() {
        if (busy) return;
        const starts = startDate.trim() ? whenFrom(startDate, startTime || '00:00') : null;
        const ends = endDate.trim() ? whenFrom(endDate, endTime || '00:00') : null;
        if ((startDate.trim() && !starts) || (endDate.trim() && !ends)) {
            setProblem(t('ads.err.when'));
            return;
        }
        const built = buildCampaignBody({ ...form, starts, ends });
        if ('errorKey' in built) {
            setProblem(t(built.errorKey));
            return;
        }
        setBusy(true);
        setProblem(null);
        try {
            await saveCampaign(api, built.body);
            router.back();
        } catch (err) {
            if (err instanceof ApiError && err.status === 402) setLocked(true);
            else setProblem(t(adsErrorKey(err)));
        } finally {
            setBusy(false);
        }
    }

    const chips = <T extends string>(values: readonly T[], current: string, pick: (v: T) => void, label: (v: T) => string) => (
        <View style={styles.chips}>
            {values.map((v) => (
                <Pressable key={v} accessibilityRole="button" accessibilityState={{ selected: current === v, disabled: !canEdit }} disabled={!canEdit} style={[styles.chip, touchTarget, current === v && styles.chipOn]} onPress={() => pick(v)}>
                    <Text style={[styles.chipText, current === v && styles.chipTextOn]}>{label(v)}</Text>
                </Pressable>
            ))}
        </View>
    );

    if (!ready) return <View style={styles.screen}><ActivityIndicator color={colors.accent} /></View>;
    if (locked) return <View style={styles.screen}><UnlockCard feature="ads" onUnlocked={() => { setReady(false); setReload((n) => n + 1); }} /></View>;

    const input = (label: string, value: string, onChange: (v: string) => void, extra: object = {}) => (
        <>
            <Text style={styles.label}>{label}</Text>
            <TextInput style={styles.input} value={value} onChangeText={onChange} editable={canEdit} accessibilityLabel={label} placeholderTextColor={colors.muted} {...extra} />
        </>
    );

    return (
        <KeyboardAvoidingView style={styles.screen} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={90}>
            <Stack.Screen options={{ title: id ? t('ads.edit') : t('ads.new') }} />
            <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
                <Text style={styles.note}>{t('ads.draftNote')}</Text>
                {!canEdit ? <Text style={styles.muted}>{t('ads.readOnly')}</Text> : null}
                {input(t('ads.name'), form.name, (v) => set('name', v), { maxLength: 120 })}
                <Text style={styles.label} accessibilityRole="header">{t('ads.network')}</Text>
                {chips(NETWORKS, form.network, (v) => set('network', v), (v) => v)}
                <Text style={styles.label} accessibilityRole="header">{t('ads.mode')}</Text>
                {chips(MODES, form.mode, (v) => set('mode', v), (v) => t(`ads.mode.${v}`))}
                {form.mode === 'boost' ? (
                    <>
                        <Text style={styles.label} accessibilityRole="header">{t('ads.post')}</Text>
                        {posts.length === 0 && !form.sourcePostId ? <Text style={styles.muted}>{t('ads.noPosts')}</Text> : null}
                        {posts.map((p) => (
                            <Pressable key={p.id} accessibilityRole="button" accessibilityState={{ selected: form.sourcePostId === p.id, disabled: !canEdit }} disabled={!canEdit} style={[styles.post, touchTarget, form.sourcePostId === p.id && styles.chipOn]} onPress={() => set('sourcePostId', p.id)}>
                                <Text style={[styles.chipText, form.sourcePostId === p.id && styles.chipTextOn]} numberOfLines={2}>{p.text.trim().slice(0, 140) || p.id.slice(0, 8)}</Text>
                            </Pressable>
                        ))}
                    </>
                ) : null}
                <Text style={styles.label} accessibilityRole="header">{t('ads.objective')}</Text>
                {chips(OBJECTIVES, form.objective, (v) => set('objective', v), (v) => t(`ads.objective.${v}`))}
                {input(t('ads.budget'), form.dailyBudget, (v) => set('dailyBudget', v), { keyboardType: 'decimal-pad' })}
                {input(t('ads.currency'), form.currency, (v) => set('currency', v.toUpperCase()), { maxLength: 3, autoCapitalize: 'characters', autoCorrect: false })}
                {input(t('ads.locations'), form.locations, (v) => set('locations', v))}
                {input(t('ads.interests'), form.interests, (v) => set('interests', v))}
                <View style={styles.row}>
                    <View style={styles.half}>{input(t('ads.ageMin'), form.ageMin, (v) => set('ageMin', v), { keyboardType: 'number-pad', maxLength: 3 })}</View>
                    <View style={styles.half}>{input(t('ads.ageMax'), form.ageMax, (v) => set('ageMax', v), { keyboardType: 'number-pad', maxLength: 3 })}</View>
                </View>
                {input(t('ads.destination'), form.destinationUrl, (v) => set('destinationUrl', v), { autoCapitalize: 'none', autoCorrect: false, keyboardType: 'url' })}
                {input(t('ads.leadForm'), form.leadFormUrl, (v) => set('leadFormUrl', v), { autoCapitalize: 'none', autoCorrect: false, keyboardType: 'url' })}
                <Text style={styles.label} accessibilityRole="header">{t('ads.starts')}</Text>
                <WhenPicker date={startDate} time={startTime} onChange={(d, tm) => { setStartDate(d); setStartTime(tm); }} />
                <Pressable accessibilityRole="button" style={[styles.clear, touchTarget]} onPress={() => setStartDate('')}><Text style={styles.clearText}>{t('ads.clearDate')}</Text></Pressable>
                <Text style={styles.label} accessibilityRole="header">{t('ads.ends')}</Text>
                <WhenPicker date={endDate} time={endTime} onChange={(d, tm) => { setEndDate(d); setEndTime(tm); }} />
                <Pressable accessibilityRole="button" style={[styles.clear, touchTarget]} onPress={() => setEndDate('')}><Text style={styles.clearText}>{t('ads.clearDate')}</Text></Pressable>
                <Text style={styles.muted}>{t('ads.launchWeb')}</Text>
                {problem ? <Text style={styles.error} accessibilityRole="alert">{problem}</Text> : null}
                {canEdit ? (
                    <Pressable accessibilityRole="button" disabled={busy} accessibilityState={{ disabled: busy }} style={[styles.button, touchTarget, busy && styles.off]} onPress={save}>
                        {busy ? <ActivityIndicator color={colors.accentInk} /> : <Text style={styles.buttonText}>{t('ads.save')}</Text>}
                    </Pressable>
                ) : null}
            </ScrollView>
        </KeyboardAvoidingView>
    );
}

const styles = StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.background, paddingHorizontal: 16 },
    body: { paddingVertical: 16, gap: 8 },
    label: { color: colors.text, fontSize: 14, fontWeight: '600', marginTop: 8 },
    input: { backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: 12, padding: 12, color: colors.text, fontSize: 16, minHeight: 48 },
    note: { color: colors.accent, fontSize: 13 },
    muted: { color: colors.muted, fontSize: 13 },
    row: { flexDirection: 'row', gap: 8 },
    half: { flex: 1 },
    chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    chip: { paddingHorizontal: 12, borderRadius: 10, backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1 },
    chipOn: { backgroundColor: colors.accent, borderColor: colors.accent },
    chipText: { color: colors.body },
    chipTextOn: { color: colors.accentInk, fontWeight: '600' },
    post: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10, backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1 },
    clear: { alignSelf: 'flex-start', justifyContent: 'center' },
    clearText: { color: colors.accent, textDecorationLine: 'underline' },
    error: { color: colors.danger },
    button: { backgroundColor: colors.accent, borderRadius: 12, alignItems: 'center', paddingVertical: 14, marginTop: 8 },
    off: { opacity: 0.4 },
    buttonText: { color: colors.accentInk, fontWeight: '700', fontSize: 16 },
});
