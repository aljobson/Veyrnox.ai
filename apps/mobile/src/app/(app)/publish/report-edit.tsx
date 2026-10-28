import { Text as StatusText } from '../../../components/ui/Text';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { touchTarget } from '../../../lib/a11y';
import { formatLocale, t } from '../../../lib/i18n';
import { fetchAccounts, type PublishAccount } from '../../../lib/publish';
import { buildReportBody, canEditReports, emptyReportForm, fetchReports, formFromReport, reportsErrorKey, saveReport, scheduleMode,
    type Report, type ReportBody, type ReportForm, type ReportsState } from '../../../lib/publishReports';
import { usePublishApi } from '../../../lib/usePublishApi';
import { colors } from '../../../theme';

const cadenceKeys = { manual: 'publishReporting.manual', weekly: 'publishReporting.weekly', monthly: 'publishReporting.monthly' } as const;
const formatKeys = { pdf: 'publishReporting.pdf', pptx: 'publishReporting.pptx' } as const;
const frequencyKeys = { weekly: 'publishReporting.everyWeek', monthly: 'publishReporting.everyMonth' } as const;
const swatches = { '#38bdf8': 'publishReporting.sky', '#a78bfa': 'publishReporting.purple', '#34d399': 'publishReporting.green' } as const;

function Choice({ label, selected, disabled, onPress, color }: { label: string; selected: boolean; disabled?: boolean; onPress: () => void; color?: string }) {
    return <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ selected, disabled: !!disabled }} disabled={disabled}
        style={[styles.choice, touchTarget, selected && styles.selected, color ? { borderStartColor: color, borderStartWidth: 4 } : null]} onPress={onPress}>
        <Text style={styles.text}>{label}</Text>
    </Pressable>;
}
function Field({ label, value, onChangeText, disabled, maxLength, multiline }: { label: string; value: string; onChangeText: (v: string) => void; disabled: boolean; maxLength: number; multiline?: boolean }) {
    return <View style={styles.group}><Text style={styles.muted}>{label}</Text><TextInput accessibilityLabel={label} style={styles.input}
        value={value} onChangeText={onChangeText} editable={!disabled} maxLength={maxLength} multiline={multiline} autoCapitalize="none" /></View>;
}
export default function ReportEdit() {
    const api = usePublishApi(), router = useRouter();
    const params = useLocalSearchParams<{ id?: string | string[] }>();
    const id = Array.isArray(params.id) ? params.id[0] : params.id;
    const [state, setState] = useState<ReportsState | null>(null);
    const [template, setTemplate] = useState<Report | null>(null);
    const [accounts, setAccounts] = useState<PublishAccount[]>([]);
    const [form, setForm] = useState<ReportForm>(emptyReportForm);
    const [error, setError] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);
    const pending = useRef(false);
    const generation = useRef(0);
    useEffect(() => {
        const version = ++generation.current;
        setState(null); setTemplate(null); setAccounts([]); setForm(emptyReportForm()); setError(null);
        Promise.allSettled([fetchReports(api), fetchAccounts(api)]).then(([reportsResult, accountsResult]) => {
            if (version !== generation.current) return;
            if (reportsResult.status === 'rejected') throw reportsResult.reason;
            const reports = reportsResult.value;
            const available = accountsResult.status === 'fulfilled' ? accountsResult.value.accounts : [];
            const found = reports.reports.find(r => r.id === id) ?? null;
            setState(reports); setAccounts(available.filter(a => a.status === 'active')); setTemplate(found);
            if (id && !found) setError(t('publishReporting.err.unavailable'));
            else setForm(found ? formFromReport(found) : emptyReportForm());
        }).catch(err => { if (version === generation.current) setError(t(reportsErrorKey(err, 'save'))); });
        return () => { generation.current++; pending.current = false; };
    }, [api, id]);
    const mode = scheduleMode(template, state ?? { scheduledReportsEnabled: false, reportDeliveryEnabled: false });
    const canEdit = !!state && canEditReports(state.brandRole);
    const disabled = busy || !canEdit || mode.readOnly;
    const change = <K extends keyof ReportForm>(key: K, value: ReportForm[K]) => setForm(f => ({ ...f, [key]: value }));
    async function submit(body: ReportBody, version: number) {
        if (version !== generation.current) return;
        setBusy(true); setError(null);
        try { await saveReport(api, body); if (version === generation.current) router.back(); }
        catch (err) { if (version === generation.current) setError(t(reportsErrorKey(err, 'save'))); }
        finally { pending.current = false; if (version === generation.current) setBusy(false); }
    }
    function save(convert = false) {
        if (!canEdit || pending.current || (mode.readOnly && !convert)) return;
        // Conversion uses saved fields, never a partial draft, and retains the stored delivery payload.
        const draft = convert && template ? { ...formFromReport(template), deliveryCadence: 'manual' } : form;
        const built = buildReportBody(draft);
        if (!built.body) { setError(t(built.errorKey)); return; }
        const body = built.body;
        if (template && (convert || !mode.deliveryEditable)) Object.assign(body, { deliveryRecipients: template.deliveryRecipients,
            deliveryReplyTo: template.deliveryReplyTo, deliveryMessage: template.deliveryMessage, deliveryFormat: template.deliveryFormat });
        const version = generation.current;
        if (convert || body.deliveryCadence !== 'manual') {
            pending.current = true;
            const message = convert ? t('publishReporting.schedule.convertConfirm') : t(mode.confirmationKey, {
                count: body.deliveryRecipients.length, format: t(formatKeys[body.deliveryFormat]),
                frequency: t(frequencyKeys[body.deliveryCadence as keyof typeof frequencyKeys]),
            });
            Alert.alert(t('publishReporting.confirm'), message, [
                { text: t('publishReporting.cancel'), style: 'cancel', onPress: () => { pending.current = false; } },
                { text: t('publishReporting.save'), onPress: () => { void submit(body, version); } },
            ], { cancelable: true, onDismiss: () => { pending.current = false; } });
        } else { pending.current = true; void submit(body, version); }
    }
    const title = id ? t('publishReporting.editReport') : t('publishReporting.new');
    if (!state || (id && !template)) return <View style={styles.screen}><Stack.Screen options={{ title }} />
        {error ? <Text style={styles.muted}>{error}</Text> : <ActivityIndicator color={colors.accent} />}</View>;
    return <KeyboardAvoidingView style={styles.screen} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <Stack.Screen options={{ title }} /><ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
            <Text style={styles.title} accessibilityRole="header">{title}</Text>
            {!canEdit ? <Text style={styles.muted}>{t('publishReporting.roleNote')}</Text> : null}
            {mode.noteKey ? <Text style={styles.muted}>{t(mode.noteKey)}</Text> : null}
            <Field label={t('publishReporting.name')} value={form.name} onChangeText={v => change('name', v)} disabled={disabled} maxLength={80} />
            <Field label={t('publishReporting.reportTitle')} value={form.reportTitle} onChangeText={v => change('reportTitle', v)} disabled={disabled} maxLength={100} />
            <Text style={styles.title} accessibilityRole="header">{t('publishReporting.account')}</Text>
            <View style={styles.row}><Choice label={t('publishReporting.all')} selected={form.accountId === null} disabled={disabled} onPress={() => change('accountId', null)} />
                {accounts.map(a => <Choice key={a.id} label={a.displayName} selected={form.accountId === a.id} disabled={disabled} onPress={() => change('accountId', a.id)} />)}
                {form.accountId && !accounts.some(a => a.id === form.accountId) ? <Text style={styles.muted}>{t('publishReporting.savedAccount')}</Text> : null}
            </View>
            <Text style={styles.title} accessibilityRole="header">{t('publishReporting.period')}</Text>
            <View style={styles.row}>{[7, 30, 90, 365].map(days => <Choice key={days} label={t('analytics.range', { days })} selected={form.rangeDays === days} disabled={disabled} onPress={() => change('rangeDays', days)} />)}</View>
            <Field label={t('publishReporting.accent')} value={form.accentColor} onChangeText={v => change('accentColor', v)} disabled={disabled} maxLength={7} />
            {!/^#[0-9a-f]{6}$/i.test(form.accentColor) ? <Text style={styles.muted}>{t('publishReporting.err.accent')}</Text> : null}
            <View style={styles.row}>{Object.entries(swatches).map(([color, key]) => <Choice key={color} color={color} label={t(key)} selected={form.accentColor.toLowerCase() === color} disabled={disabled} onPress={() => change('accentColor', color)} />)}</View>
            <View style={styles.toggle}><Text style={styles.text}>{t('analytics.compare')}</Text><Switch accessibilityLabel={t('analytics.compare')} accessibilityState={{ checked: form.comparePrevious, disabled }} value={form.comparePrevious} disabled={disabled} onValueChange={v => change('comparePrevious', v)} /></View>
            <View style={styles.toggle}><Text style={styles.text}>{t('publishReporting.includeContent')}</Text><Switch accessibilityLabel={t('publishReporting.includeContent')} accessibilityState={{ checked: form.includeContent, disabled }} value={form.includeContent} disabled={disabled} onValueChange={v => change('includeContent', v)} /></View>
            <Text style={styles.title} accessibilityRole="header">{t('publishReporting.schedule')}</Text>
            {mode.cadenceEditable ? <View style={styles.row}>{(Object.keys(cadenceKeys) as (keyof typeof cadenceKeys)[]).map(cadence => <Choice key={cadence} label={t(cadenceKeys[cadence])} selected={form.deliveryCadence === cadence} disabled={disabled} onPress={() => change('deliveryCadence', cadence)} />)}</View> :
                <Text style={styles.text}>{Object.hasOwn(cadenceKeys, form.deliveryCadence) ? t(cadenceKeys[form.deliveryCadence as keyof typeof cadenceKeys]) : t('publishReporting.manual')}</Text>}
            {form.deliveryCadence !== 'manual' ? <>
                <Text style={styles.muted}>{t('publishReporting.hour')}</Text>
                <View style={styles.row}>{Array.from({ length: 24 }, (_, hour) => <Choice key={hour}
                    label={new Intl.DateTimeFormat(formatLocale(), { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: 'UTC' }).format(new Date(Date.UTC(2026, 9, 19, hour)))}
                    selected={form.deliveryHourUtc === hour} disabled={disabled} onPress={() => change('deliveryHourUtc', hour)} />)}</View>
                <Text style={styles.muted}>{form.deliveryCadence === 'weekly' ? t('publishReporting.weekday') : t('publishReporting.day')}</Text>
                <View style={styles.row}>{Array.from({ length: form.deliveryCadence === 'weekly' ? 7 : 28 }, (_, i) => <Choice key={i}
                    label={form.deliveryCadence === 'weekly' ? new Intl.DateTimeFormat(formatLocale(), { weekday: 'long', timeZone: 'UTC' }).format(new Date(Date.UTC(2026, 9, 19 + i))) : (i + 1).toLocaleString(formatLocale())}
                    selected={(form.deliveryCadence === 'weekly' ? form.deliveryWeekday : form.deliveryDay) === i + 1} disabled={disabled}
                    onPress={() => change(form.deliveryCadence === 'weekly' ? 'deliveryWeekday' : 'deliveryDay', i + 1)} />)}</View>
            </> : null}
            <Field label={t('publishReporting.recipients')} value={Array.isArray(form.deliveryRecipients) ? form.deliveryRecipients.join(', ') : form.deliveryRecipients}
                onChangeText={v => change('deliveryRecipients', v)} disabled={disabled || !mode.deliveryEditable} maxLength={3000} multiline />
            <Text style={styles.muted}>{t('publishReporting.recipientLimit')}</Text>
            <Text style={styles.muted}>{t('publishReporting.format')}</Text>
            <View style={styles.row}>{(['pdf', 'pptx'] as const).map(format => <Choice key={format} label={t(formatKeys[format])} selected={form.deliveryFormat === format} disabled={disabled || !mode.deliveryEditable} onPress={() => change('deliveryFormat', format)} />)}</View>
            <Field label={t('publishReporting.replyTo')} value={form.deliveryReplyTo} onChangeText={v => change('deliveryReplyTo', v)} disabled={disabled || !mode.deliveryEditable} maxLength={254} />
            <Field label={t('publishReporting.message')} value={form.deliveryMessage} onChangeText={v => change('deliveryMessage', v)} disabled={disabled || !mode.deliveryEditable} maxLength={1000} multiline />
            {error ? <StatusText variant="inherit" style={styles.muted} accessibilityLiveRegion="polite">{error}</StatusText> : null}
            {busy ? <StatusText variant="inherit" style={styles.muted} accessibilityLiveRegion="polite">{t('publishReporting.saving')}</StatusText> : null}
            {canEdit ? <Pressable accessibilityRole="button" accessibilityLabel={mode.readOnly ? t('publishReporting.schedule.convert') : t('publishReporting.save')}
                accessibilityState={{ busy, disabled: busy }} disabled={busy} style={[styles.choice, styles.selected, touchTarget]} onPress={() => save(mode.readOnly)}>
                <Text style={styles.text}>{mode.readOnly ? t('publishReporting.schedule.convert') : t('publishReporting.save')}</Text>
            </Pressable> : null}
        </ScrollView>
    </KeyboardAvoidingView>;
}
const styles = StyleSheet.create({ screen: { flex: 1, backgroundColor: colors.background }, body: { padding: 16, gap: 12 },
    group: { gap: 6 }, row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 }, toggle: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
    title: { color: colors.text, fontSize: 16, fontWeight: '600' }, text: { color: colors.body }, muted: { color: colors.muted, fontSize: 13 },
    input: { color: colors.text, padding: 12, borderWidth: 1, borderColor: colors.border, borderRadius: 10, backgroundColor: colors.surface },
    choice: { paddingHorizontal: 12, borderRadius: 10, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface }, selected: { borderColor: colors.accent } });
