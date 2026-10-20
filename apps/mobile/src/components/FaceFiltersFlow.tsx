import { File, Paths } from 'expo-file-system';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { Stack, useRouter } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { ApiError, type ApiClient } from '../lib/api';
import { getCacheUser, subscribeCacheUser } from '../lib/appCache';
import { faceDefaults, faceFilterMessage, faceFilterUploadMessage, faceFilters, faceInputs, faceRequest, faceSelectors, type FaceValues } from '../lib/faceFilters';
import { createGenerationSubmit } from '../lib/generationSubmit';
import { fetchCatalog, textInput, type CatalogModel } from '../lib/media';
import { shortfall } from '../lib/lowBalance';
import { useBalance } from '../lib/useBalance';
import { checkPicked, pickedProblem, type PickedFile } from '../lib/sources';
import { uploadSource } from '../lib/uploads';
import { t } from '../lib/i18n';
import { colors } from '../theme';
import { FaceFilterResult } from './FaceFilterResult';

export function FaceFiltersFlow({ api, owner }: { api: ApiClient; owner: string }) {
    const router = useRouter();
    const balance = useBalance();
    const [models, setModels] = useState<CatalogModel[] | null>(null);
    const [model, setModel] = useState<CatalogModel | null>(null);
    const [photo, setPhoto] = useState<PickedFile | null>(null);
    const [values, setValues] = useState<FaceValues>({});
    const [prompt, setPrompt] = useState('');
    const [checked, setChecked] = useState(false);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [job, setJob] = useState<string | null>(null);
    const submit = useRef(createGenerationSubmit());
    const source = useRef<string | null>(null);
    const local = useRef<PickedFile | null>(null);
    const working = useRef(false);
    const controller = useRef(new AbortController());
    const current = () => !controller.current.signal.aborted && getCacheUser() === owner;

    // Delete only the picker's temporary copy, never a user's original photo.
    function discardFile(file: PickedFile | null) {
        const uri = file?.uri;
        if (uri?.startsWith(Paths.cache.uri)) {
            try { const file = new File(uri); if (file.exists) file.delete(); } catch { /* OS may already have reclaimed it. */ }
        }
    }
    function discardPhoto() { discardFile(local.current); local.current = null; }
    useEffect(() => {
        controller.current = new AbortController();
        const off = subscribeCacheUser(() => {
            if (getCacheUser() !== owner) {
                controller.current.abort(); discardPhoto(); source.current = null; submit.current.reset();
                setPhoto(null); setChecked(false); setJob(null);
            }
        });
        return () => { off(); controller.current.abort(); discardPhoto(); submit.current.reset(); };
    }, [owner]);

    function load() {
        setError(null);
        fetchCatalog().then(all => { if (current()) setModels(faceFilters(all)); }).catch(() => { if (current()) setError(t('create.loadError')); });
    }
    useEffect(load, []);

    function reset(next: CatalogModel | null = null) {
        discardPhoto(); source.current = null; submit.current.reset();
        setPhoto(null); setModel(next); setValues(next ? faceDefaults(next) : {}); setPrompt(''); setChecked(false); setJob(null); setError(null);
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
            setPhoto(file); setChecked(false);
        } catch { if (current()) setError(t('common.error')); }
        finally { working.current = false; if (current()) setBusy(false); }
    }
    const selectors = model ? faceSelectors(model) : null;
    let invalid = false;
    if (model) { try { faceInputs(model, values); } catch { invalid = true; } }
    const missing = model ? shortfall(balance, model.credits) : 0;
    const ready = !!photo && checked && !invalid && (model?.id !== 'face-relight' || !!prompt.trim()) && missing === 0;

    async function run() {
        if (!model || !photo || !ready || working.current || !current()) return;
        working.current = true; setBusy(true); setError(null);
        // Snapshot the checked attestation for this one attempt, then require another
        // deliberate tick for every later attempt. AI-sharing is a separate gate.
        const attested = checked;
        setChecked(false);
        try {
            const valid = checkPicked('image', photo);
            if (!valid.ok) throw new ApiError(400, 'invalid_inputs');
            if (!source.current) source.current = await uploadSource(api, photo, valid.contentType, () => {}, controller.current.signal);
            if (!current()) return;
            const id = await submit.current.run(api, faceRequest(model, source.current, prompt, values, attested));
            if (current()) setJob(id);
        } catch (err) {
            if (!current()) return;
            if (err instanceof ApiError && (err.code.startsWith('upload_') || err.code.startsWith('source_') || err.code === 'too_many_pending_uploads') && err.code !== 'upload_admission_unavailable') {
                setError(faceFilterUploadMessage(err));
                if (err.code === 'source_not_found') { source.current = null; submit.current.reset(); }
            } else setError(faceFilterMessage(err));
        } finally { working.current = false; if (current()) setBusy(false); }
    }
    if (job && photo) return <FaceFilterResult api={api} owner={owner} id={job} original={photo.uri} onAnother={() => reset(model)} />;
    return (
        <ScrollView style={styles.screen} contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
            <Stack.Screen options={{ title: t('faceFilters.title') }} />
            <Text style={styles.heading} accessibilityRole="header">{model?.name ?? t('faceFilters.title')}</Text>
            <Text style={styles.text}>{t('faceFilters.privacy')}</Text>
            {!models && !error ? <ActivityIndicator /> : null}
            {!model ? <>
                {models?.length === 0 ? <Text style={styles.text}>{t('faceFilters.closed')}</Text> : null}
                {models?.map(m => <Pressable key={m.id} accessibilityRole="button" accessibilityLabel={`${m.name}. ${t(`faceFilters.${m.id}`)}. ${t('faceFilters.price', { credits: String(m.credits) })}`} style={styles.card} onPress={() => reset(m)}>
                    <Text accessible={false} style={styles.text}>◉</Text>
                    <Text style={styles.text}>{m.name}</Text>
                    <Text style={styles.text}>{t(`faceFilters.${m.id}`)}</Text>
                    <Text style={styles.price}>{t('faceFilters.price', { credits: String(m.credits) })}</Text>
                </Pressable>)}
                {error ? <Pressable accessibilityRole="button" accessibilityLabel={t('job.checkAgain')} style={styles.card} onPress={load}><Text style={styles.text}>{t('job.checkAgain')}</Text></Pressable> : null}
            </> : <>
                <Pressable accessibilityRole="button" accessibilityLabel={t('faceFilters.change')} disabled={busy} style={styles.card} onPress={() => reset()}><Text style={styles.text}>{t('faceFilters.change')}</Text></Pressable>
                <Pressable accessibilityRole="button" accessibilityLabel={t('faceFilters.pick')} disabled={busy} accessibilityState={{ disabled: busy }} style={styles.card} onPress={pick}><Text style={styles.text}>{t('faceFilters.pick')}</Text></Pressable>
                {photo ? <Image source={{ uri: photo.uri }} cachePolicy="none" transition={0} style={styles.photo} contentFit="contain" accessibilityLabel={t('faceFilters.before')} /> : null}
                {selectors?.enums.map(({ key, values: choices }) => <View key={key} style={styles.group}>
                    <Text style={styles.heading} accessibilityRole="header">{t(`faceFilters.${key}`)}</Text>
                    {choices.map(value => <Pressable key={value} accessibilityRole="radio" accessibilityLabel={t(`faceFilters.${value}`)} accessibilityState={{ checked: values[key] === value, disabled: busy }} disabled={busy} style={[styles.card, values[key] === value && styles.selected]} onPress={() => { setValues(v => ({ ...v, [key]: value })); setChecked(false); }}><Text style={styles.text}>{t(`faceFilters.${value}`)}</Text></Pressable>)}
                </View>)}
                {selectors?.age ? <>
                    <Text style={styles.text}>{t('faceFilters.target_age', { min: String(selectors.age.min), max: String(selectors.age.max) })}</Text>
                    <TextInput accessibilityLabel={t('faceFilters.target_age', { min: String(selectors.age.min), max: String(selectors.age.max) })} keyboardType="number-pad" style={styles.input} editable={!busy} value={String(values.target_age ?? '')} placeholderTextColor={colors.muted} maxLength={3} onChangeText={value => { setValues(v => ({ ...v, target_age: value })); setChecked(false); }} />
                    {invalid ? <Text style={styles.error}>{t('faceFilters.invalidAge')}</Text> : null}
                </> : null}
                {selectors?.identity ? <Pressable accessibilityRole="checkbox" accessibilityLabel={t('faceFilters.preserve_identity')} accessibilityState={{ checked: values.preserve_identity === true, disabled: busy }} disabled={busy} style={styles.card} onPress={() => { setValues(v => ({ ...v, preserve_identity: !v.preserve_identity })); setChecked(false); }}><Text style={styles.text}>{values.preserve_identity ? '☑ ' : '☐ '}{t('faceFilters.preserve_identity')}</Text></Pressable> : null}
                {model.id === 'face-relight' ? <TextInput accessibilityLabel={t('faceFilters.prompt')} placeholder={t('faceFilters.prompt')} placeholderTextColor={colors.muted} style={styles.input} editable={!busy} multiline maxLength={textInput(model)?.max ?? 2000} value={prompt} onChangeText={value => { setPrompt(value); setChecked(false); }} /> : null}
                <View style={styles.card}><Text style={styles.price}>{t('faceFilters.price', { credits: String(model.credits) })}</Text></View>
                {missing > 0 ? <Pressable accessibilityRole="button" accessibilityLabel={t('lowBalance.buy')} style={styles.card} onPress={() => router.push('/credits')}><Text style={styles.text}>{t('form.err.insufficient')} {t('lowBalance.buy')}</Text></Pressable> : null}
                <Pressable accessibilityRole="checkbox" accessibilityLabel={t('faceFilters.rights')} accessibilityState={{ checked, disabled: busy }} disabled={busy} style={[styles.card, checked && styles.selected]} onPress={() => setChecked(v => !v)}><Text style={styles.text}>{checked ? '☑ ' : '☐ '}{t('faceFilters.rights')}</Text></Pressable>
                <Pressable accessibilityRole="link" accessibilityLabel={t('faceFilters.policy')} style={styles.card} onPress={() => { void WebBrowser.openBrowserAsync('https://veyrnox.ai/legal/aup').catch(() => setError(t('common.error'))); }}><Text style={styles.text}>{t('faceFilters.policy')}</Text></Pressable>
                <Pressable accessibilityRole="button" accessibilityLabel={`${t('faceFilters.run')}. ${t('faceFilters.price', { credits: String(model.credits) })}`} accessibilityState={{ disabled: !ready || busy, busy }} disabled={!ready || busy} style={[styles.card, (!ready || busy) && styles.disabled]} onPress={run}><Text style={styles.text}>{t('faceFilters.run')}</Text>{busy ? <ActivityIndicator /> : null}</Pressable>
            </>}
            {error ? <Text style={styles.error} accessibilityLiveRegion="polite">{error}</Text> : null}
        </ScrollView>
    );
}
const styles = StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.background }, body: { padding: 16, gap: 14, paddingBottom: 100 },
    heading: { color: colors.text, fontSize: 20, fontWeight: '700' }, text: { color: colors.text, fontSize: 16 },
    card: { minHeight: 44, padding: 14, gap: 6, borderWidth: 1, borderColor: colors.border, borderRadius: 12, backgroundColor: colors.surface },
    selected: { borderColor: colors.accent }, disabled: { opacity: 0.4 }, group: { gap: 8 },
    input: { minHeight: 44, padding: 14, color: colors.text, borderColor: colors.border, borderWidth: 1, borderRadius: 12 },
    photo: { width: '100%', height: 280 }, price: { color: colors.money, fontSize: 16 }, error: { color: colors.danger },
});
