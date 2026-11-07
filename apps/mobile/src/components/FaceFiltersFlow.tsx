import { rawText } from '../lib/i18n/translate';
import { Text as StatusText } from './ui/Text';
import { english } from '../lib/i18n/binding';
import { useAnnouncement } from '../lib/useAnnouncement';
import { discardCacheCopy } from '../lib/cacheFiles';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { Stack, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { AppState, Platform, ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View, useWindowDimensions } from 'react-native';
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
import { Button, Icon } from './ui';
import { InstantPhoto, liveLooksAvailable } from './InstantPhoto';
import { LookStrip } from './LookStrip';
import { StrengthSlider } from './StrengthSlider';
import { DEFAULT_STRENGTH, isUnchanged, lookMatrix, type Look, type LookId } from '../lib/instantLooks';
import { saveLookToPhotos } from '../lib/lookExport';
import { makeThumb } from '../lib/lookThumb';
import { kindForMime } from '../lib/creativeReuse';
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
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    useAnnouncement(error);
    const [job, setJob] = useState<string | null>(null);
    const [look, setLook] = useState<Look>({ id: 'original', strength: DEFAULT_STRENGTH });
    const [thumb, setThumb] = useState<string | null>(null);
    const [catalogError, setCatalogError] = useState<string | null>(null);
    useAnnouncement(catalogError);
    const [notice, setNotice] = useState<string | null>(null);
    const [saving, setSaving] = useState(false);
    useAnnouncement(notice);
    const { width: screenWidth } = useWindowDimensions();
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
                clearResult(); setPhoto(null); setJob(null);
            }
        });
        return () => { off(); controller.current.abort(); discardPhoto(); resultRef.current = null; submit.current.reset(); };
    }, [owner]);

    function load() {
        // The catalog has its own error, so choosing a photo or a look never hides its retry button.
        setCatalogError(null);
        fetchCatalog().then(all => { if (current()) setModels(faceFilters(all)); }).catch(() => { if (current()) setCatalogError(t('create.loadError')); });
    }
    useEffect(load, []);

    function reset(next: CatalogModel | null = null) {
        discardPhoto(); source.current = null; clearResult(); submit.current.reset();
        setPhoto(null); setModel(next); setValues(next ? faceDefaults(next) : {}); setPrompt(''); setJob(null); setError(null);
        setLook({ id: 'original', strength: DEFAULT_STRENGTH }); setNotice(null);
    }
    function chooseFilter(next: CatalogModel) {
        setModel(next); setValues(faceDefaults(next)); setPrompt('');
        setError(null); setJob(null); submit.current.reset();
        setLook({ id: 'original', strength: DEFAULT_STRENGTH }); setNotice(null);
    }
    function chooseLook(id: LookId) {
        // A look is instant and on this phone: nothing is uploaded, no rights tick, no credits.
        setModel(null); setError(null); setNotice(null);
        setLook(current => ({ id, strength: id === current.id ? current.strength : DEFAULT_STRENGTH }));
    }
    function applyResult(result: { jobId: string; uri: string }) {
        if (!current()) return;
        const next = { ...result, fetchedAt: Date.now() };
        discardPhoto(); source.current = null; submit.current.reset(); setPhoto(null);
        resultRef.current = next; setFromResult(next);
        errorRefreshFor.current = null; setPreviewUnavailable(false);
        setModel(null); setValues({}); setPrompt(''); setJob(null); setError(null);
        setLook({ id: 'original', strength: DEFAULT_STRENGTH }); setNotice(null);
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
            clearResult(); setPhoto(file);
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
    const ready = !!(photo || fromResult) && !invalid && !promptTooLong && (model?.id !== 'face-relight' || !!prompt.trim()) && missing === 0;

    async function run() {
        if (!model || !(photo || fromResult) || !ready || promptTooLong || working.current || !current()) return;
        working.current = true; setBusy(true); setError(null);
        // The rights statement is part of the Terms and Acceptable Use Policy; AI-sharing is a separate gate.
        const attested = true;
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
    // The strip's small copy of the photo. It is a face, so it is deleted when replaced, on leaving and on an account change.
    useEffect(() => {
        setThumb(null);
        if (!original || !liveLooksAvailable()) return;
        let live = true;
        let made: string | null = null;
        void makeThumb(original).then(uri => {
            if (!uri) return;
            if (live && current()) { made = uri; setThumb(uri); } else discardCacheCopy(uri);
        });
        return () => { live = false; if (made) discardCacheCopy(made); };
    }, [original, owner]);
    const lookChosen = !model && !!original && look.id !== 'original';
    const lookOn = lookChosen && !isUnchanged(look);
    async function saveLook() {
        if (!original || saving || !current()) return;
        setSaving(true); setNotice(null);
        try {
            let source = original;
            const attached = resultRef.current;
            if (attached && !photo) {
                // A result's link lasts 15 minutes: ask for a fresh one right before exporting.
                const fresh = await mediaApi(api).getAsset(attached.jobId);
                if (!current() || resultRef.current?.jobId !== attached.jobId) return;
                if (kindForMime(fresh.mime_type) !== 'image') throw new Error('look_export_failed');
                source = fresh.url;
            }
            const saved = await saveLookToPhotos(source, look, () => current() && (!attached || resultRef.current?.jobId === attached.jobId));
            if (current()) setNotice(t(saved ? 'faceFilters.look.saved' : 'faceFilters.look.denied'));
        } catch (err) { if (current() && !(err instanceof Error && err.message === 'look_export_cancelled')) setNotice(t('faceFilters.look.saveFailed')); }
        finally { if (current()) setSaving(false); }
    }
    const unavailable = fromResult && previewUnavailable ? <>
        <Text style={styles.text}>{t('editor.previewunavailable')}</Text>
        <Pressable accessibilityRole="button" accessibilityLabel={t('filmWorkspace.retry')} style={styles.card} onPress={refreshResult}><Text style={styles.text}>{t('filmWorkspace.retry')}</Text></Pressable>
    </> : null;
    if (job && (photo || fromResult)) return <FaceFilterResult api={api} owner={owner} id={job} original={original!} onAnother={() => reset(model)} onApplyResult={applyResult}
        onOriginalError={fromResult ? resultImageError : undefined} onOriginalLoad={fromResult ? resultImageLoaded : undefined} originalFallback={unavailable} />;
    return (
        <ScrollView style={styles.screen} contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
            <Stack.Screen options={{ title: t('faceFilters.title') }} />
            <View style={[styles.stage, { height: Math.round(screenWidth * 1.25) }]}>
                {original
                    ? <InstantPhoto uri={original} matrix={lookMatrix(look)} cover label={t(model ? 'faceFilters.before' : 'faceFilterSwitch.attached')} style={StyleSheet.absoluteFill} onError={fromResult ? resultImageError : undefined} onLoad={fromResult ? resultImageLoaded : undefined} />
                    : <Pressable accessibilityRole="button" accessibilityLabel={t('faceFilters.pick')} disabled={busy} accessibilityState={{ disabled: busy }} style={styles.empty} onPress={pick}><Icon name="paperclip" size={28} tint="#fff" /><Text style={styles.emptyText}>{t('faceFilters.pick')}</Text></Pressable>}
                {original ? <Pressable accessibilityRole="button" accessibilityLabel={t('faceFilters.pick')} disabled={busy} accessibilityState={{ disabled: busy }} style={styles.pill} onPress={pick}><Icon name="paperclip" size={16} tint="#fff" /><Text style={styles.pillText}>{t('faceFilters.pick')}</Text></Pressable> : null}
                {lookChosen ? <View style={styles.slider}><StrengthSlider label={t('faceFilters.look.strength')} value={look.strength} disabled={busy} onChange={strength => setLook(c => ({ ...c, strength }))} /></View> : null}
            </View>
            {unavailable}
            {!models && !catalogError ? <ActivityIndicator /> : null}
            <LookStrip thumb={thumb} enabled={!!original && liveLooksAvailable()} live={liveLooksAvailable()} look={look.id} modelId={model?.id ?? null} models={models ?? []} busy={busy} onLook={chooseLook} onModel={chooseFilter} />
            <View style={styles.content}>
            {models?.length === 0 ? <Text style={styles.text}>{t('faceFilters.closed')}</Text> : null}
            {catalogError && !models ? <><Text style={styles.error}>{catalogError}</Text><Pressable accessibilityRole="button" accessibilityLabel={t('job.checkAgain')} style={styles.card} onPress={load}><Text style={styles.text}>{t('job.checkAgain')}</Text></Pressable></> : null}
            {!original ? <Text style={styles.muted}>{t('faceFilters.look.needPhoto')}</Text> : null}
            {lookOn ? <Button variant="primary" label={t('faceFilters.look.save')} accessibilityLabel={t('faceFilters.look.save')} loading={saving} disabled={saving} onPress={saveLook} /> : null}
            {notice ? <StatusText variant="inherit" style={styles.text}>{notice}</StatusText> : null}
            <Text accessibilityLanguage="en" style={styles.muted}>{english('faceFilters.privacy')}</Text>
            {model ? <>
                {selectors?.enums.map(({ key, values: choices }) => <View key={key} style={styles.group}>
                    <Text style={styles.heading} accessibilityRole="header">{t(`faceFilters.${key}`)}</Text>
                    <View style={styles.wrap}>{choices.map(value => <Pressable key={value} accessibilityRole="radio" accessibilityLabel={t(`faceFilters.${value}`)} accessibilityState={{ checked: values[key] === value, disabled: busy }} disabled={busy} style={[styles.choice, values[key] === value && styles.selected]} onPress={() => { setValues(v => ({ ...v, [key]: value })); }}><Text style={styles.text}>{t(`faceFilters.${value}`)}</Text></Pressable>)}</View>
                </View>)}
                {selectors?.age ? <>
                    <Text style={styles.text}>{t('faceFilters.target_age', { min: String(selectors.age.min), max: String(selectors.age.max) })}</Text>
                    <TextInput accessibilityLabel={rawText(t('faceFilters.target_age', { min: String(selectors.age.min), max: String(selectors.age.max) }))} keyboardType="number-pad" style={styles.input} editable={!busy} value={String(values.target_age ?? '')} placeholderTextColor={colors.muted} maxLength={3} onChangeText={value => { setValues(v => ({ ...v, target_age: value })); }} />
                    {invalid ? <Text style={styles.error}>{t('faceFilters.invalidAge')}</Text> : null}
                </> : null}
                {selectors?.identity ? <Pressable accessibilityRole="checkbox" accessibilityLabel={t('faceFilters.preserve_identity')} accessibilityState={{ checked: values.preserve_identity === true, disabled: busy }} disabled={busy} style={styles.card} onPress={() => { setValues(v => ({ ...v, preserve_identity: !v.preserve_identity })); }}><Text style={styles.text}>{values.preserve_identity ? '☑ ' : '☐ '}{t('faceFilters.preserve_identity')}</Text></Pressable> : null}
                {model.id === 'face-relight' ? <><TextInput accessibilityLabel={t('faceFilters.prompt')} placeholder={t('faceFilters.prompt')} placeholderTextColor={colors.muted} style={styles.input} editable={!busy} multiline value={prompt} onChangeText={value => { setPrompt(value); }} />{promptTooLong ? <StatusText variant="inherit" style={styles.error} accessibilityRole="alert">{t(promptLimitKey, { count: String(prompt.trim().length), max: String(promptLimit) })}</StatusText> : null}</> : null}
                <View style={styles.card}><Text style={styles.price}>{t('faceFilters.price', { credits: String(model.credits) })}</Text></View>
                {missing > 0 ? <Pressable accessibilityRole="button" accessibilityLabel={t('lowBalance.buy')} style={styles.card} onPress={() => router.push('/credits')}><Text style={styles.text}>{t('form.err.insufficient')} {t('lowBalance.buy')}</Text></Pressable> : null}
                <Pressable accessibilityRole="link" accessibilityLabel={t('faceFilters.policy')} style={styles.card} onPress={() => { router.push('/legal/aup'); }}><Text style={styles.text}>{t('faceFilters.policy')}</Text></Pressable>
                <Button variant="primary" accessibilityLabel={rawText(`${t('faceFilters.run')}. ${t('faceFilters.price', { credits: String(model.credits) })}`)} accessibilityState={{ busy }} disabled={!ready} loading={busy} label={`${t('faceFilters.run')} · ${t('faceFilters.price', { credits: String(model.credits) })}`} onPress={run} />
            </> : null}
            {error ? <StatusText variant="inherit" style={styles.error} accessibilityLiveRegion={Platform.OS === 'android' ? 'polite' : undefined}>{error}</StatusText> : null}
            </View>
        </ScrollView>
    );
}
const styles = StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.background }, body: { gap: 12, paddingBottom: 100 },
    content: { paddingHorizontal: 16, gap: 12 },
    stage: { backgroundColor: '#000', overflow: 'hidden', justifyContent: 'flex-end' },
    empty: { ...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'center', gap: 8 },
    pill: { position: 'absolute', top: 12, right: 12, minHeight: 36, flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, borderRadius: 18, backgroundColor: 'rgba(0,0,0,0.55)' },
    emptyText: { color: '#fff', fontSize: 16, fontWeight: '600' },
    pillText: { color: '#fff', fontSize: 13, fontWeight: '600' },
    slider: { paddingBottom: 12 },
    heading: { color: colors.text, fontSize: 20, fontWeight: '700' }, text: { color: colors.text, fontSize: 16 },
    card: { minHeight: 44, padding: 14, gap: 6, borderWidth: 1, borderColor: colors.border, borderRadius: 12, backgroundColor: colors.surface },
    wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    choice: { minHeight: 44, paddingHorizontal: 16, justifyContent: 'center', borderWidth: 1, borderColor: colors.border, borderRadius: 22, backgroundColor: colors.surface },
    selected: { borderColor: colors.accent, borderWidth: 2 }, disabled: { opacity: 0.4 }, group: { gap: 8 },
    input: { minHeight: 44, padding: 14, color: colors.text, borderColor: colors.borderStrong, borderWidth: 1, borderRadius: 12 },
    photo: { width: '100%', height: 280 }, price: { color: colors.money, fontSize: 14, fontWeight: '600' }, error: { color: colors.danger },
    option: { flexDirection: 'row', alignItems: 'center', gap: 14 }, optionText: { flex: 1, gap: 2 },
    name: { color: colors.text, fontSize: 16, fontWeight: '600' }, muted: { color: colors.muted, fontSize: 14 },
});
