import { useEffect, useRef, useState } from 'react';
import { View } from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { useAuth } from '../../auth/AuthProvider';
import { Button, Chip, Text, TextField, themedStyles, useThemedStyles } from '../ui';
import { KeyboardScreen } from '../KeyboardScreen';
import { KeyboardFormScrollView } from '../KeyboardFormScrollView';
import { CreateResult, type ResultBatch } from '../create/CreateResult';
import { ModelUnavailable } from '../create/ModelUnavailable';
import { ApiError } from '../../lib/api';
import { getCacheUser, subscribeCacheUser } from '../../lib/appCache';
import { refreshBalance } from '../../lib/createResult';
import { createGenerationSubmit, generationMessage } from '../../lib/generationSubmit';
import { fetchCatalog, estimateCredits, type CatalogModel } from '../../lib/media';
import { rememberSubmitted } from '../../lib/submittedRequests';
import { DEFAULT_CINEMA } from '../../lib/cinemaCamera';
import { useBalance } from '../../lib/useBalance';
import { shortfall } from '../../lib/lowBalance';
import { useAnnouncement } from '../../lib/useAnnouncement';
import { t } from '../../lib/i18n';
import { DEFAULT_TTS_SETTINGS, TTS_EXAMPLES, TTS_SCRIPT_LIMIT, type SpeechSettings } from '../../lib/speech/shared';
import { buildSpeechRequest, insertCue, validateSpeech } from '../../lib/speech/studio';
import { speechModel } from '../../lib/speech/model';
import { SpeechLabel, speechLayout } from './SpeechFields';
import { VoicePicker } from './VoicePicker';
import { SpeechControls } from './SpeechControls';
import { InsertBar } from './InsertBar';
import { SpeechPricePanel } from './SpeechPricePanel';

export function SpeechStudio() {
    const { api } = useAuth();
    const router = useRouter();
    const styles = useThemedStyles(sheets);
    const balance = useBalance();
    const [catalog, setCatalog] = useState<CatalogModel[] | null>(null);
    const [catalogError, setCatalogError] = useState<string | null>(null);
    const [script, setScript] = useState('');
    const [settings, setSettings] = useState<SpeechSettings>({ ...DEFAULT_TTS_SETTINGS });
    const [error, setError] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);
    const [result, setResult] = useState<ResultBatch | null>(null);
    const [priceOverride, setPriceOverride] = useState<number | null>(null);
    const pending = useRef(createGenerationSubmit());
    const epoch = useRef(0), balanceSeq = useRef(0), sending = useRef(false);
    useAnnouncement(error ?? (busy ? t('speech.submitting') : result ? t('speech.accepted') : null));
    useEffect(() => {
        let live = true;
        void fetchCatalog().then(rows => { if (live) setCatalog(rows); }).catch(() => { if (live) setCatalogError(t('form.modelLoad')); });
        return () => { live = false; };
    }, []);
    useEffect(() => {
        const unsubscribe = subscribeCacheUser(() => {
            epoch.current++; balanceSeq.current++; pending.current.reset();
            setScript(''); setSettings({ ...DEFAULT_TTS_SETTINGS }); setResult(null); setError(null); setPriceOverride(null);
        });
        return () => { unsubscribe(); epoch.current++; balanceSeq.current++; };
    }, []);
    function resetAttempt() {
        epoch.current++; balanceSeq.current++; pending.current.reset();
        setResult(null); setError(null); setPriceOverride(null);
    }
    function editScript(next: string) { if (sending.current) return; if (next !== script) resetAttempt(); setScript(next); }
    function editSettings(next: SpeechSettings) {
        if (sending.current) return;
        if (JSON.stringify(next) !== JSON.stringify(settings)) resetAttempt();
        setSettings(next);
    }
    const model = speechModel(catalog ?? []);
    if (!model) return <ModelUnavailable title={t('speech.title')} recovery={{ label: t('speech.back'), onPress: () => router.canGoBack() ? router.back() : router.replace('/audio') }} fromTemplate={false} error={catalogError ?? (catalog ? t('form.modelGone') : null)} />;
    const validation = validateSpeech(script, settings);
    const unit = priceOverride ?? estimateCredits(model, null);
    const request = validation ? null : { ...buildSpeechRequest(script, settings, model), confirmedCredits: unit };
    const quote = request ? pending.current.snapshot(request, 1, unit, 0) : { total: unit, payable: unit, ceilings: [unit] };
    async function generate() {
        if (!model || !request || sending.current || result || shortfall(balance, quote.payable) > 0) return;
        sending.current = true; setBusy(true); setError(null);
        const generation = epoch.current, owner = getCacheUser();
        const current = () => generation === epoch.current && owner === getCacheUser();
        try {
            await pending.current.run(api, request, 1, undefined, id => {
                if (!current()) return;
                void rememberSubmitted(id, request, { prompt: request.prompt }, {
                    opts: { aspect: null, count: 1, seed: '', negative: '', voice: '', audioSeconds: '' },
                    cameraOn: false, cinema: DEFAULT_CINEMA, characterOn: false, character: {},
                }).catch(() => undefined);
                setResult({ ids: [id], modelId: model.id, kind: 'audio', aspect: null, duration: null, count: 1 });
            }, quote);
        } catch (cause) {
            if (!current()) return;
            if (cause instanceof ApiError && cause.code === 'price_changed' && Number.isInteger(cause.body.expected_credits) && Number(cause.body.expected_credits) >= 0) setPriceOverride(Number(cause.body.expected_credits));
            setError(generationMessage(cause));
        } finally {
            sending.current = false; setBusy(false);
            if (current()) void refreshBalance(api, owner, current, balanceSeq);
        }
    }
    const generation = epoch.current, owner = getCacheUser();
    const settled = () => { if (generation === epoch.current && owner === getCacheUser()) void refreshBalance(api, owner, () => generation === epoch.current, balanceSeq); };
    return <KeyboardScreen style={styles.screen}>
        <Stack.Screen options={{ title: t('speech.title') }} />
        <KeyboardFormScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
            <SpeechLabel icon="microphone" label={t('speech.title')} />
            <Text tone="secondary">{t('speech.intro')}</Text>
            {result ? <><Text accessibilityLiveRegion="polite">{t('speech.accepted')}</Text><CreateResult api={api} batch={result} catalog={catalog ?? []} onTerminal={settled} />
                <Button label={t('speech.adjust')} disabled={busy} onPress={resetAttempt} /></> : <>
                <TextField label={t('speech.script')} value={script} onChangeText={editScript} maxLength={TTS_SCRIPT_LIMIT} multiline editable={!busy} style={styles.script} />
                <Text variant="caption">{t('speech.counter', { count: script.length, max: TTS_SCRIPT_LIMIT })}</Text>
                {validation && script.length > 0 && <Text tone="danger" accessibilityLiveRegion="polite">{t(validation)}</Text>}
                <View pointerEvents={busy ? 'none' : 'auto'} accessibilityElementsHidden={busy} importantForAccessibility={busy ? 'no-hide-descendants' : 'auto'} style={speechLayout.section}>
                    <SpeechLabel icon="lightbulb" label={t('speech.examples')} />
                    <View style={speechLayout.chips}>{TTS_EXAMPLES.map((example, index) => <Chip key={example.title} label={t(`speech.example.${index}`)} onPress={() => editScript(example.text)} />)}</View>
                    <InsertBar onInsert={cue => { const next = insertCue(script, cue); if (next.tooLong) setError(t('speech.tooLong')); else editScript(next.script); }} />
                    <VoicePicker value={settings.voice} onChange={voice => editSettings({ ...settings, voice })} />
                    <SpeechControls value={settings} onChange={editSettings} />
                </View>
                {error && <Text tone="danger" accessibilityRole="alert" accessibilityLiveRegion="polite">{error}</Text>}
                <SpeechPricePanel price={quote.total} payable={quote.payable} balance={balance} disabled={!!validation} busy={busy} onGenerate={() => void generate()} onCredits={() => router.push('/credits')} />
            </>}
        </KeyboardFormScrollView>
    </KeyboardScreen>;
}
const sheets = themedStyles(p => ({ screen: { flex: 1, backgroundColor: p.bg }, body: { padding: 16, gap: 20, paddingBottom: 40 }, script: { minHeight: 140, textAlignVertical: 'top' } }));
