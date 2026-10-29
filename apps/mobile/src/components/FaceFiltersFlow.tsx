import { rawText } from '../lib/i18n/translate';
import { Text as StatusText } from './ui/Text';
import { english } from '../lib/i18n/binding';
import { useAnnouncement } from '../lib/useAnnouncement';
import { discardCacheCopy } from '../lib/cacheFiles';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { Stack, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { AppState, Platform, ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { ApiError, type ApiClient } from '../lib/api';
import { getCacheUser, subscribeCacheUser } from '../lib/appCache';
import { faceDefaults, faceFilterMessage, faceFilterUploadMessage, faceFilters, faceInputs, faceRequest, faceSelectors, type FaceValues } from '../lib/faceFilters';
import { createGenerationSubmit } from '../lib/generationSubmit';
import { fetchCatalog, mediaApi, textInput, type CatalogModel } from '../lib/media';
import { shortfall } from '../lib/lowBalance';
import { useBalance } from '../lib/useBalance';
import { checkPicked, pickedProblem, type PickedFile } from '../lib/sources';
import { uploadSource } from '../lib/uploads';
import { t } from '../lib/i18n';
import { colors } from '../theme';
import { FaceFilterResult } from './FaceFilterResult';
import { Button, Icon, IconBadge } from './ui';
import { kindForMime } from '../lib/creativeReuse';
import { faceIcon } from '../lib/featureIcons';
import { GENERATION_PROMPT_MAX } from '../lib/promptLimits';

export const RESULT_LINK_REFRESH_MS = 10 * 60 * 1000;
type ResultSource = { jobId: string; uri: string; fetchedAt: number };

export function FaceFiltersFlow({ api, owner }: { api: ApiClient; owner: string }) {
    const router = useRouter();
    const balance = useBalance();
    const [models, setModels] = useState<CatalogModel[] | null>(null);
    const [model, setModel] = useState<CatalogModel | null>(null);
    const [photo, setPhoto] = useState<PickedFile | null>(null);
    const [fromResult, setFromResult] = useState<ResultSource | null>(null);
    const resultRef = useRef<ResultSource | null>(null);
    const refreshing = useRef(false);
    const errorRefreshFor = useRef<string | null>(null);
    const [previewUnavailable, setPreviewUnavailable] = useState(false);
    const [values, setValues] = useState<FaceValues>({});
    const [prompt, setPrompt] = useState('');
    const [checked, setChecked] = useState(false);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    useAnnouncement(error);
    const [job, setJob] = useState<string | null>(null);
    useAnnouncement(fromResult && !model && !job ? t('faceFilterSwitch.resultAttached') : null);
    const submit = useRef(createGenerationSubmit());
    const source = useRef<string | null>(null);
    const local = useRef<PickedFile | null>(null);
    const working = useRef(false);
    const controller = useRef(new AbortController());
    const current = () => !controller.current.signal.aborted && getCacheUser() === owner;

    function clearResult() {
        resultRef.current = null; setFromResult(null);
        errorRefreshFor.current = null; setPreviewUnavailable(false);
    }
    async function refreshResult() {
        const attached = resultRef.current;
        if (!attached || refreshing.current || !current()) return;
        refreshing.current = true;
        const jobId = attached.jobId;
        try {
            const fresh = await mediaApi(api).getAsset(jobId);
            // The identity check also rejects a replacement with the same job id.
            if (!current() || resultRef.current !== attached || resultRef.current.jobId !== jobId) return;
            if (kindForMime(fresh.mime_type) !== 'image') return;
            const next = { jobId, uri: fresh.url, fetchedAt: Date.now() };
            if (errorRefreshFor.current) errorRefreshFor.current = fresh.url;
            resultRef.current = next; setFromResult(next); setPreviewUnavailable(false);
        } catch { /* Preview failure must not prevent running by asset id. */ }
        finally { refreshing.current = false; }
    }
    function resultImageError() {
        if (!fromResult || resultRef.current?.uri !== fromResult.uri || !current()) return;
        setPreviewUnavailable(true);
        if (errorRefreshFor.current) return;
        errorRefreshFor.current = fromResult.uri;
        void refreshResult();
    }
    function resultImageLoaded() {
        if (!fromResult || resultRef.current?.uri !== fromResult.uri || !current()) return;
        errorRefreshFor.current = null; setPreviewUnavailable(false);
    }
    function refreshStaleResult() {
        const attached = resultRef.current;
        if (attached && Date.now() - attached.fetchedAt > RESULT_LINK_REFRESH_MS) void refreshResult();
    }
    useEffect(refreshStaleResult, [model, job]);
    useEffect(() => {
        const sub = AppState.addEventListener('change', state => { if (state === 'active') refreshStaleResult(); });
        return () => sub.remove();
    }, [api, owner]);

    // Delete only the picker's temporary copy, never a user's original photo.
    function discardFile(file: PickedFile | null) {
        discardCacheCopy(file?.uri);
    }
    function discardPhoto() { discardFile(local.current); local.current = null; }
    useEffect(() => {
        controller.current = new AbortController();
        const off = subscribeCacheUser(() => {
            if (getCacheUser() !== owner) {
                controller.current.abort(); discardPhoto(); source.current = null; submit.current.reset();
                clearResult(); setPhoto(null); setChecked(false); setJob(null);
            }
        });
        return () => { off(); controller.current.abort(); discardPhoto(); resultRef.current = null; submit.current.reset(); };
    }, [owner]);

    function load() {
        setError(null);
        fetchCatalog().then(all => { if (current()) setModels(faceFilters(all)); }).catch(() => { if (current()) setError(t('create.loadError')); });
    }
    useEffect(load, []);

    function reset(next: CatalogModel | null = null) {
        discardPhoto(); source.current = null; clearResult(); submit.current.reset();
        setPhoto(null); setModel(next); setValues(next ? faceDefaults(next) : {}); setPrompt(''); setChecked(false); setJob(null); setError(null);
    }
    function chooseFilter(next: CatalogModel) {
        setModel(next); setValues(faceDefaults(next)); setPrompt(''); setChecked(false);
        setError(null); setJob(null); submit.current.reset();
    }
    function applyResult(result: { jobId: string; uri: string }) {
        if (!current()) return;
        const next = { ...result, fetchedAt: Date.now() };
        discardPhoto(); source.current = null; submit.current.reset(); setPhoto(null);
        resultRef.current = next; setFromResult(next);
        errorRefreshFor.current = null; setPreviewUnavailable(false);
        setModel(null); setValues({}); setPrompt(''); setChecked(false); setJob(null); setError(null);
    }
    async function pick() {
        if (working.current) return;
        working.current = true; setBusy(true); setError(null);
        try {
            const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsMultipleSelection: false, allowsEditing: false, quality: 1, exif: false, base64: false });
            if (result.canceled) return;
            const asset = result.assets[0];
            const file: PickedFile = { uri: asset.uri, size: asset.fileSize, mimeType: asset.mimeType };
            if (!current()) {
                // A picker can resolve after the account has already left.
                discardFile(file); return;
            }
            const valid = checkPicked('image', file);
            if (!valid.ok) { discardFile(file); setError(pickedProblem(valid.error, 'image')); return; }
            discardPhoto(); local.current = file; source.current = null; submit.current.reset();
            clearResult(); setPhoto(file); setChecked(false);
        } catch { if (current()) setError(t('common.error')); }
        finally { working.current = false; if (current()) setBusy(false); }
    }
    const selectors = model ? faceSelectors(model) : null;
    let invalid = false;
    if (model) { try { faceInputs(model, values); } catch { invalid = true; } }
    const missing = model ? shortfall(balance, model.credits) : 0;
    const promptLimit = model ? textInput(model)?.max ?? GENERATION_PROMPT_MAX : GENERATION_PROMPT_MAX;
    const promptLimitKey = promptLimit < GENERATION_PROMPT_MAX ? 'public.TemplateRecipe.promptTooLong' : 'public.TemplateRecipe.productPromptTooLong';
    const promptTooLong = prompt.trim().length > promptLimit;
    const ready = !!(photo || fromResult) && checked && !invalid && !promptTooLong && (model?.id !== 'face-relight' || !!prompt.trim()) && missing === 0;

    async function run() {
        if (!model || !(photo || fromResult) || !ready || promptTooLong || working.current || !current()) return;
        working.current = true; setBusy(true); setError(null);
        // Snapshot the checked attestation for this one attempt, then require another
        // deliberate tick for every later attempt. AI-sharing is a separate gate.
        const attested = checked;
        setChecked(false);
        try {
            let input: string | { assetId: string };
            if (fromResult) input = { assetId: fromResult.jobId };
            else {
                if (!photo) return;
                const valid = checkPicked('image', photo);
                if (!valid.ok) throw new ApiError(400, 'invalid_inputs');
                if (!source.current) source.current = await uploadSource(api, photo, valid.contentType, () => {}, controller.current.signal);
                input = source.current;
            }
            if (!current()) return;
            const id = await submit.current.run(api, faceRequest(model, input, prompt, values, attested));
            if (current()) setJob(id);
        } catch (err) {
            if (!current()) return;
            if (err instanceof ApiError && (err.code.startsWith('upload_') || err.code.startsWith('source_') || err.code === 'too_many_pending_uploads') && err.code !== 'upload_admission_unavailable') {
                setError(faceFilterUploadMessage(err));
                if (fromResult && (err.code === 'source_not_found' || err.code === 'source_asset_invalid')) { clearResult(); submit.current.reset(); }
                if (err.code === 'source_not_found') { source.current = null; submit.current.reset(); }
            } else setError(faceFilterMessage(err));
        } finally { working.current = false; if (current()) setBusy(false); }
    }
    const original = photo?.uri ?? fromResult?.uri;
    const unavailable = fromResult && previewUnavailable ? <>
        <Text style={styles.text}>{t('editor.previewunavailable')}</Text>
        <Pressable accessibilityRole="button" accessibilityLabel={t('filmWorkspace.retry')} style={styles.card} onPress={refreshResult}><Text style={styles.text}>{t('filmWorkspace.retry')}</Text></Pressable>
    </> : null;
    if (job && (photo || fromResult)) return <FaceFilterResult api={api} owner={owner} id={job} original={original!} onAnother={() => reset(model)} onApplyResult={applyResult}
        onOriginalError={fromResult ? resultImageError : undefined} onOriginalLoad={fromResult ? resultImageLoaded : undefined} originalFallback={unavailable} />;
    return (
        <ScrollView style={styles.screen} contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
            <Stack.Screen options={{ title: t('faceFilters.title') }} />
            <Text style={styles.heading} accessibilityRole="header">{model?.name ?? t('faceFilters.title')}</Text>
            <Text accessibilityLanguage="en" style={styles.text}>{english('faceFilters.privacy')}</Text>
            {!models && !error ? <ActivityIndicator /> : null}
            {!model ? <>
                {original ? <>
                    <Image source={{ uri: original }} cachePolicy="none" transition={0} style={styles.attached} contentFit="contain" accessibilityLabel={t('faceFilterSwitch.attached')} onError={fromResult ? resultImageError : undefined} onLoad={fromResult ? resultImageLoaded : undefined} />
                    {unavailable}
                    <Text style={styles.text}>{t('faceFilterSwitch.kept')}</Text>
                </> : null}
                {models?.length === 0 ? <Text style={styles.text}>{t('faceFilters.closed')}</Text> : null}
                {models?.map(m => <Pressable key={m.id} accessibilityRole="button" accessibilityLabel={`${m.name}. ${t(`faceFilters.${m.id}`)}. ${t('faceFilters.price', { credits: String(m.credits) })}`} style={[styles.card, styles.option]} onPress={() => chooseFilter(m)}>
                    <IconBadge {...faceIcon(m.id)} size="lg" />
                    <View style={styles.optionText}>
                        <Text style={styles.name}>{m.name}</Text>
                        <Text style={styles.muted}>{t(`faceFilters.${m.id}`)}</Text>
                        <Text style={styles.price}>{t('faceFilters.price', { credits: String(m.credits) })}</Text>
                    </View>
                    <Icon name="caretRight" size={20} />
                </Pressable>)}
                {error ? <Pressable accessibilityRole="button" accessibilityLabel={t('job.checkAgain')} style={styles.card} onPress={load}><Text style={styles.text}>{t('job.checkAgain')}</Text></Pressable> : null}
            </> : <>
                <Pressable accessibilityRole="button" accessibilityLabel={t('faceFilterSwitch.changeLabel', { name: model.name })} disabled={busy} accessibilityState={{ disabled: busy }} style={styles.card} onPress={() => { setModel(null); setChecked(false); }}><Text style={styles.text}>{t('faceFilterSwitch.current', { name: model.name })} · {t('faceFilterSwitch.change')}</Text></Pressable>
                <Pressable accessibilityRole="button" accessibilityLabel={t('faceFilters.pick')} disabled={busy} accessibilityState={{ disabled: busy }} style={styles.card} onPress={pick}><Text style={styles.text}>{t('faceFilters.pick')}</Text></Pressable>
                {original ? <Image source={{ uri: original }} cachePolicy="none" transition={0} style={styles.photo} contentFit="contain" accessibilityLabel={t('faceFilters.before')} onError={fromResult ? resultImageError : undefined} onLoad={fromResult ? resultImageLoaded : undefined} /> : null}
                {unavailable}
                {selectors?.enums.map(({ key, values: choices }) => <View key={key} style={styles.group}>
                    <Text style={styles.heading} accessibilityRole="header">{t(`faceFilters.${key}`)}</Text>
                    {choices.map(value => <Pressable key={value} accessibilityRole="radio" accessibilityLabel={t(`faceFilters.${value}`)} accessibilityState={{ checked: values[key] === value, disabled: busy }} disabled={busy} style={[styles.card, values[key] === value && styles.selected]} onPress={() => { setValues(v => ({ ...v, [key]: value })); setChecked(false); }}><Text style={styles.text}>{t(`faceFilters.${value}`)}</Text></Pressable>)}
                </View>)}
                {selectors?.age ? <>
                    <Text style={styles.text}>{t('faceFilters.target_age', { min: String(selectors.age.min), max: String(selectors.age.max) })}</Text>
                    <TextInput accessibilityLabel={rawText(t('faceFilters.target_age', { min: String(selectors.age.min), max: String(selectors.age.max) }))} keyboardType="number-pad" style={styles.input} editable={!busy} value={String(values.target_age ?? '')} placeholderTextColor={colors.muted} maxLength={3} onChangeText={value => { setValues(v => ({ ...v, target_age: value })); setChecked(false); }} />
                    {invalid ? <Text style={styles.error}>{t('faceFilters.invalidAge')}</Text> : null}
                </> : null}
                {selectors?.identity ? <Pressable accessibilityRole="checkbox" accessibilityLabel={t('faceFilters.preserve_identity')} accessibilityState={{ checked: values.preserve_identity === true, disabled: busy }} disabled={busy} style={styles.card} onPress={() => { setValues(v => ({ ...v, preserve_identity: !v.preserve_identity })); setChecked(false); }}><Text style={styles.text}>{values.preserve_identity ? '☑ ' : '☐ '}{t('faceFilters.preserve_identity')}</Text></Pressable> : null}
                {model.id === 'face-relight' ? <><TextInput accessibilityLabel={t('faceFilters.prompt')} placeholder={t('faceFilters.prompt')} placeholderTextColor={colors.muted} style={styles.input} editable={!busy} multiline value={prompt} onChangeText={value => { setPrompt(value); setChecked(false); }} />{promptTooLong ? <Text style={styles.error} accessibilityRole="alert">{t(promptLimitKey, { count: String(prompt.trim().length), max: String(promptLimit) })}</Text> : null}</> : null}
                <View style={styles.card}><Text style={styles.price}>{t('faceFilters.price', { credits: String(model.credits) })}</Text></View>
                {missing > 0 ? <Pressable accessibilityRole="button" accessibilityLabel={t('lowBalance.buy')} style={styles.card} onPress={() => router.push('/credits')}><Text style={styles.text}>{t('form.err.insufficient')} {t('lowBalance.buy')}</Text></Pressable> : null}
                <Pressable accessibilityRole="checkbox" accessibilityLanguage="en" accessibilityLabel={english('faceFilters.rights')} accessibilityState={{ checked, disabled: busy }} disabled={busy} style={[styles.card, checked && styles.selected]} onPress={() => setChecked(v => !v)}><Text style={styles.text}>{checked ? '☑ ' : '☐ '}{english('faceFilters.rights')}</Text></Pressable>
                <Pressable accessibilityRole="link" accessibilityLabel={t('faceFilters.policy')} style={styles.card} onPress={() => { router.push('/legal/aup'); }}><Text style={styles.text}>{t('faceFilters.policy')}</Text></Pressable>
                <Button variant="primary" accessibilityLabel={rawText(`${t('faceFilters.run')}. ${t('faceFilters.price', { credits: String(model.credits) })}`)} accessibilityState={{ busy }} disabled={!ready} loading={busy} label={`${t('faceFilters.run')} · ${t('faceFilters.price', { credits: String(model.credits) })}`} onPress={run} />
            </>}
            {error ? <StatusText variant="inherit" style={styles.error} accessibilityLiveRegion={Platform.OS === 'android' ? 'polite' : undefined}>{error}</StatusText> : null}
        </ScrollView>
    );
}
const styles = StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.background }, body: { padding: 16, gap: 14, paddingBottom: 100 },
    heading: { color: colors.text, fontSize: 20, fontWeight: '700' }, text: { color: colors.text, fontSize: 16 },
    card: { minHeight: 44, padding: 14, gap: 6, borderWidth: 1, borderColor: colors.border, borderRadius: 12, backgroundColor: colors.surface },
    selected: { borderColor: colors.accent }, disabled: { opacity: 0.4 }, group: { gap: 8 },
    input: { minHeight: 44, padding: 14, color: colors.text, borderColor: colors.borderStrong, borderWidth: 1, borderRadius: 12 },
    attached: { width: 96, height: 96 },
    photo: { width: '100%', height: 280 }, price: { color: colors.money, fontSize: 14, fontWeight: '600' }, error: { color: colors.danger },
    option: { flexDirection: 'row', alignItems: 'center', gap: 14 }, optionText: { flex: 1, gap: 2 },
    name: { color: colors.text, fontSize: 16, fontWeight: '600' }, muted: { color: colors.muted, fontSize: 14 },
});
