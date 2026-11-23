import { useEffect, useRef, useState } from 'react';
import { View } from 'react-native';
import { useRouter } from 'expo-router';
import { randomUUID } from 'expo-crypto';
import { Button, Text, TextField, themedStyles, useThemedStyles } from './ui';
import { t } from '../lib/i18n';
import { useAuth } from '../auth/AuthProvider';
import { getCacheUser } from '../lib/appCache';
import { fetchAllCatalog, type CatalogModel } from '../lib/media';
import { uploadSource, putFromDisk } from '../lib/uploads';
import { createSeedance25Session, seedance25Models, type ClipQuote } from '../../../../lib/seedance25Client.mjs';
import { ds } from '../theme';

export function Seedance25EditorActions({ uri, assetId }: { uri?: string; assetId?: string }) {
    const [models, setModels] = useState<CatalogModel[]>([]);
    useEffect(() => { let live = true; void fetchAllCatalog().then(rows => { if (live) setModels(rows); }, () => {}); return () => { live = false; }; }, []);
    return <Seedance25Actions models={models} uri={uri} assetId={assetId} />;
}
export function Seedance25Actions({ models, assetId, uri }: { models: readonly CatalogModel[]; assetId?: string; uri?: string }) {
    const styles = useThemedStyles(sheets), { api } = useAuth(), router = useRouter();
    const offers = seedance25Models(models);
    const [chosen, setChosen] = useState<string | null>(null), [prompt, setPrompt] = useState('');
    const [quote, setQuote] = useState<ClipQuote | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState(false), [jobId, setJobId] = useState<string | null>(null);
    const [attempted, setAttempted] = useState(false);
    const attempt = useRef<ReturnType<typeof createSeedance25Session> | null>(null), lock = useRef(false), alive = useRef(true);
    const upload = useRef(new AbortController());
    useEffect(() => { alive.current = true; const controller = upload.current; return () => { alive.current = false; controller.abort(); }; }, []);
    if (!offers.length || (!assetId && !uri)) return null;
    const model = offers.find(m => m.id === chosen);
    function session() {
        if (!attempt.current) {
            const owner = getCacheUser();
            attempt.current = createSeedance25Session({
                makeKey: randomUUID, current: () => alive.current && !!owner && owner === getCacheUser(),
                request: (path, body) => api.request(`/api/v1${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
                reference: async () => assetId ? { slot: 'video', origin: 'asset', asset_id: assetId }
                    : { slot: 'video', origin: 'upload', key: await uploadSource(api, { uri: uri! }, 'video/mp4', () => {}, upload.current.signal, putFromDisk) },
            });
        }
        return attempt.current;
    }
    async function run(submit: boolean) {
        if (lock.current || !model) return;
        lock.current = true; setBusy(true); setError(false);
        try {
            if (submit) { const result = await session().submit(); if (alive.current) setJobId(result.job_id); }
            else { const result = await session().quote(model!, prompt); if (alive.current) setQuote(result); }
        } catch { if (alive.current) { setError(true); if (!attempt.current?.attempted) setQuote(null); } }
        finally { lock.current = false; if (alive.current) { setBusy(false); setAttempted(!!attempt.current?.attempted); } }
    }
    if (jobId) return <Button variant="secondary" label={t('app.seedance25.result')} onPress={() => router.push({ pathname: '/job/[id]', params: { id: jobId } })} />;

    return <View style={styles.panel}>
        <View style={styles.actions}>{offers.map(offer => <Button key={offer.id} variant="secondary" disabled={busy || attempted}
            accessibilityState={{ selected: chosen === offer.id }} label={t(offer.id.endsWith('-edit') ? 'app.seedance25.edit' : 'app.seedance25.extend')}
            onPress={() => { setChosen(offer.id); setQuote(null); }} />)}</View>
        {model ? <>
            <Text variant="footnote" tone="secondary">{t('app.seedance25.cap')}</Text>
            <TextField label={t('app.seedance25.prompt')} multiline maxLength={30000} editable={!busy && !attempted} value={prompt}
                onChangeText={value => { setPrompt(value); setQuote(null); }} />
            <Text variant="footnote" tone="secondary">{t('app.seedance25.rights')}</Text>
            {quote ? <Text accessibilityLiveRegion="polite">{t('app.seedance25.price', { credits: quote.credits })}</Text> : null}
            <Button disabled={busy || !prompt.trim()} label={t(busy ? 'app.seedance25.wait' : attempted ? 'app.seedance25.retry' : quote ? 'app.seedance25.confirm' : 'app.seedance25.quote')}
                onPress={() => void run(!!quote)} />
        </> : null}
        {error ? <Text tone="danger" accessibilityRole="alert">{t('app.seedance25.error')}</Text> : null}
    </View>;
}
const sheets = themedStyles(() => ({ panel: { gap: ds.space.sm }, actions: { flexDirection: 'row', flexWrap: 'wrap', gap: ds.space.sm } }));
