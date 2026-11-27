import { randomUUID } from 'expo-crypto';
import * as ImagePicker from 'expo-image-picker';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { useAuth } from '../../../auth/AuthProvider';
import { Button, Chip, Text, themedStyles, useThemedStyles } from '../../../components/ui';
import { ApiError } from '../../../lib/api';
import { catalogTemplateImageBounds } from '../../../lib/catalogTemplateInputs';
import { t } from '../../../lib/i18n';
import { uploadSource } from '../../../lib/uploads';

type Picked = { uri: string; size: number; mime: string; name: string };
type Price = { resolution: string; credits: number };

export default function CatalogTemplateRun() {
    const s = useThemedStyles(sheets); const router = useRouter(); const { api } = useAuth();
    const params = useLocalSearchParams<{ provider?: string; catalogId?: string; name?: string; min?: string; max?: string; credits?: string; prices?: string; guidance?: string }>();
    const rawMin = Number(params.min), rawMax = Number(params.max);
    const { min, max } = catalogTemplateImageBounds(params.provider, rawMin, rawMax);
    let prices: Price[] = []; try { const parsed = JSON.parse(params.prices || '[]'); if (Array.isArray(parsed)) prices = parsed.filter(item => item && typeof item.resolution === 'string' && Number.isInteger(item.credits) && item.credits > 0); } catch { /* invalid handoff */ }
    let guidance: string[] = []; try { const parsed = JSON.parse(params.guidance || '[]'); if (Array.isArray(parsed)) guidance = parsed.filter(item => typeof item === 'string' && item.trim()).slice(0, 3); } catch { /* invalid handoff */ }
    const [resolution, setResolution] = useState(prices[0]?.resolution || '');
    const price = prices.find(item => item.resolution === resolution)?.credits || Number(params.credits) || 0;
    const [files, setFiles] = useState<Picked[]>([]), [rights, setRights] = useState(false), [busy, setBusy] = useState(false);
    const [message, setMessage] = useState(''), [submitted, setSubmitted] = useState(false);
    const abort = useRef<AbortController | null>(null), key = useRef(`catalog-template-${randomUUID()}`);
    useEffect(() => () => abort.current?.abort(), []);
    const valid = ['kling', 'seedance', 'vidu'].includes(params.provider || '') && typeof params.catalogId === 'string' && price > 0;
    async function choose() {
        const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsMultipleSelection: max > 1, selectionLimit: max,
            allowsEditing: false, quality: 1, exif: false, base64: false,
            preferredAssetRepresentationMode: ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Compatible });
        if (result.canceled) return;
        const selected: Picked[] = [];
        for (const asset of result.assets.slice(0, max)) {
            const blob = asset.fileSize ? null : await (await fetch(asset.uri)).blob();
            const mime = asset.mimeType || blob?.type || 'image/jpeg'; const size = asset.fileSize || blob?.size || 0;
            if (size > 0 && ['image/jpeg', 'image/png', 'image/webp'].includes(mime)) selected.push({ uri: asset.uri, size, mime, name: asset.fileName || `image-${selected.length + 1}` });
        }
        setFiles(selected); setMessage(''); key.current = `catalog-template-${randomUUID()}`;
    }
    async function generate() {
        if (!valid || busy || (files.length > 0 && !rights) || files.length < min || files.length > max) return;
        const controller = new AbortController(); abort.current = controller; setBusy(true); setMessage('');
        try {
            const source_keys = [];
            for (const file of files) source_keys.push({ slot: 'image', key: await uploadSource(api, file, file.mime, () => {}, controller.signal) });
            await api.request('/api/v1/generations', { method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: controller.signal, body: JSON.stringify({
                model_id: 'catalog-template', idempotency_key: key.current, inputs: {}, source_keys, consent: files.length > 0, confirmed_credits: price,
                catalog_template: { provider: params.provider, catalog_id: params.catalogId, ...(resolution ? { resolution } : {}) },
            }) });
            setSubmitted(true);
        } catch (error) {
            setMessage(error instanceof ApiError && error.code === 'insufficient_balance' ? t('generation.insufficientCredits') : t('crunTemplates.run.failed'));
        } finally { if (abort.current === controller) abort.current = null; setBusy(false); }
    }
    return <ScrollView contentContainerStyle={s.screen}>
        <Stack.Screen options={{ title: params.name || t('crunTemplates.use') }} />
        <Text variant="title1" accessibilityRole="header">{params.name || t('crunTemplates.use')}</Text>
        <Text tone="accent">{t('crunTemplates.price', { credits: price })}</Text>
        {submitted ? <View style={s.card}><Text>{t('crunTemplates.run.submitted')}</Text><Button label={t('crunTemplates.run.library')} onPress={() => router.replace('/library' as never)} /></View> : <>
            {prices.length ? <View style={s.card}><Text variant="bodyStrong">{t('crunTemplates.run.resolution')}</Text><View style={s.row}>{prices.map(item => <Chip key={item.resolution} selected={resolution === item.resolution} label={`${item.resolution} · ${item.credits}`} onPress={() => { setResolution(item.resolution); key.current = `catalog-template-${randomUUID()}`; }} />)}</View></View> : null}
            {max > 0 ? <><View style={s.card}><Text variant="bodyStrong">{t('crunTemplates.run.imageOrder')}</Text>{guidance.map((line, index) => <Text key={`${index}:${line}`} tone="secondary">{line}</Text>)}</View><View style={s.card}><Button variant="secondary" label={t('crunTemplates.run.images')} onPress={() => void choose()} /><Text tone="secondary">{t('crunTemplates.run.selected', { count: files.length, max })}</Text>{files.map(file => <Text key={file.uri} variant="caption">{file.name}</Text>)}</View>
            <Button variant="secondary" accessibilityRole="checkbox" accessibilityState={{ checked: rights }} label={t('crunTemplates.run.rights')} onPress={() => setRights(value => !value)} /></> : <Text tone="secondary">{t('crunTemplates.run.noImages')}</Text>}
            {message ? <Text tone="danger" accessibilityLiveRegion="assertive">{message}</Text> : null}
            <Button loading={busy} disabled={!valid || (files.length > 0 && !rights) || files.length < min || files.length > max} label={t('crunTemplates.run.generate', { credits: price })} onPress={() => void generate()} />
        </>}
    </ScrollView>;
}

const sheets = themedStyles(() => ({ screen: { padding: 16, gap: 16 }, card: { gap: 12 }, row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 } }));
