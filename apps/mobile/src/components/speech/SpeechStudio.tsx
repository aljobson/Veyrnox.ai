import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { useAuth } from '../../auth/AuthProvider';
import { Button, Chip, Text, TextField, themedStyles, useThemedStyles } from '../ui';
import { KeyboardScreen } from '../KeyboardScreen';
import { KeyboardFormScrollView } from '../KeyboardFormScrollView';
import { CreateResult } from '../create/CreateResult';
import { ModelUnavailable } from '../create/ModelUnavailable';
import { fetchCatalog, estimateCredits, type CatalogModel } from '../../lib/media';
import { useBalance } from '../../lib/useBalance';
import { useAnnouncement } from '../../lib/useAnnouncement';
import { t } from '../../lib/i18n';
import { DEFAULT_TTS_SETTINGS, TTS_EXAMPLES, TTS_SCRIPT_LIMIT, auditionCost, toggleAuditionVoice, voiceAuditionScript, type SpeechSettings } from '../../lib/speech/shared';
import { buildSpeechRequest, insertCue, validateSpeech } from '../../lib/speech/studio';
import { auditionQuote, buildAuditionRequest, validateAudition } from '../../lib/speech/audition';
import { AuditionBoard } from './AuditionBoard';
import { AuditionResults } from './AuditionResults';
import { speechModel } from '../../lib/speech/model';
import { SpeechLabel, speechLayout } from './SpeechFields';
import { VoicePicker } from './VoicePicker';
import { SpeechControls } from './SpeechControls';
import { InsertBar } from './InsertBar';
import { SpeechPricePanel } from './SpeechPricePanel';
import { useSpeechSubmission } from './useSpeechSubmission';
import { useStudioReopen } from './useStudioReopen';
import { restoreSpeech } from '../../lib/speech/restore';

export function SpeechStudio({ reopen }: { reopen?: string | string[] }) {
    const { api } = useAuth();
    const router = useRouter();
    const styles = useThemedStyles(sheets);
    const balance = useBalance();
    const [catalog, setCatalog] = useState<CatalogModel[] | null>(null);
    const [catalogError, setCatalogError] = useState<string | null>(null);
    const [script, setScript] = useState('');
    const [settings, setSettings] = useState<SpeechSettings>({ ...DEFAULT_TTS_SETTINGS });
    const [voices, setVoices] = useState<string[]>([]);
    const { pending, sending, busy, result, visibleJobs, complete, error, setError, priceFor, resetAttempt, editAttempt, generate, settled } = useSpeechSubmission(api, () => {
        setScript(''); setSettings({ ...DEFAULT_TTS_SETTINGS }); setVoices([]);
    });
    const restored = useStudioReopen(reopen, request => {
        const saved = restoreSpeech(request);
        if (!saved) return false;
        setScript(saved.script); setSettings(saved.settings); setVoices([]); return true;
    }, () => { resetAttempt(); setScript(''); setSettings({ ...DEFAULT_TTS_SETTINGS }); setVoices([]); }, jobId => pending.current.markDelivered(jobId));
    useAnnouncement(error ?? (busy ? t('speech.submitting') : result || complete ? t('speech.accepted') : null));
    useEffect(() => {
        let live = true;
        void fetchCatalog().then(rows => { if (live) setCatalog(rows); }).catch(() => { if (live) setCatalogError(t('form.modelLoad')); });
        return () => { live = false; };
    }, []);
    function editScript(next: string) {
        if (sending.current || restored.loading) return;
        editAttempt(next.trim() !== script.trim()); setScript(next); restored.dismiss();
    }
    function editSettings(next: SpeechSettings) {
        if (sending.current || restored.loading) return;
        const effectiveNext = voices.length > 0 ? { ...next, voice: settings.voice } : next;
        editAttempt(JSON.stringify(effectiveNext) !== JSON.stringify(settings));
        setSettings(next); restored.dismiss();
    }
    function editVoices(next: string[]) {
        if (sending.current || restored.loading || JSON.stringify(next) === JSON.stringify(voices)) return;
        editAttempt(true); setVoices(next); restored.dismiss();
    }
    function testVoice(voice: string) {
        if (sending.current || restored.loading) return;
        const nextScript = voiceAuditionScript();
        editAttempt(script.trim() !== nextScript.trim() || (voices.length === 0 && settings.voice !== voice));
        setSettings({ ...settings, voice }); setScript(nextScript); restored.dismiss();
    }
    const model = speechModel(catalog ?? []);
    if (!model) return <ModelUnavailable title={t('speech.title')} recovery={{ label: t('speech.back'), onPress: () => router.canGoBack() ? router.back() : router.replace('/audio') }} fromTemplate={false} error={catalogError ?? (catalog ? t('form.modelGone') : null)} />;
    const boardActive = voices.length > 0, count = boardActive ? voices.length : 1;
    const validation = boardActive ? validateAudition(script, settings, voices) : validateSpeech(script, settings);
    const unpriced = validation ? null : boardActive ? buildAuditionRequest(script, settings, voices, model) : buildSpeechRequest(script, settings, model);
    const unit = priceFor(unpriced, count) ?? estimateCredits(model, null);
    const request = unpriced ? { ...unpriced, confirmedCredits: unit } : null;
    const jobs = visibleJobs(request, voices);
    const price = boardActive ? auditionCost(unit, voices) : unit;
    const quote = request ? boardActive ? auditionQuote(pending.current, request, unit) : pending.current.snapshot(request, 1, unit, 0)
        : { total: price, payable: price, ceilings: Array(count).fill(unit) };
    const showRemaining = quote.total !== price || jobs.length > 0 || !!request && pending.current.hasUnknownOutcome(request, count);
    return <KeyboardScreen style={styles.screen}>
        <Stack.Screen options={{ title: t('speech.title') }} />
        <KeyboardFormScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
            <SpeechLabel icon="microphone" label={t('speech.title')} />
            <Text tone="secondary">{t('speech.intro')}</Text>
            {restored.unavailable && <Text accessibilityLiveRegion="polite">{t('dialogue.restoreUnavailable')}</Text>}
            {result || complete ? <><Text accessibilityLiveRegion="polite">{t('speech.accepted')}</Text>{result ? <CreateResult api={api} batch={result} catalog={catalog ?? []} onTerminal={settled} /> : <AuditionResults api={api} jobs={jobs} modelId={model.id} catalog={catalog ?? []} onTerminal={settled} />}
                <Button label={t('speech.adjust')} disabled={busy} onPress={resetAttempt} /></> : <>
                <TextField label={t('speech.script')} value={script} onChangeText={editScript} maxLength={TTS_SCRIPT_LIMIT} multiline editable={!busy && !restored.loading} style={styles.script} />
                <Text variant="caption">{t('speech.counter', { count: script.length, max: TTS_SCRIPT_LIMIT })}</Text>
                {validation && script.length > 0 && <Text tone="danger" accessibilityLiveRegion="polite">{t(validation)}</Text>}
                <View pointerEvents={busy || restored.loading ? 'none' : 'auto'} accessibilityElementsHidden={busy} importantForAccessibility={busy ? 'no-hide-descendants' : 'auto'} style={speechLayout.section}>
                    <SpeechLabel icon="lightbulb" label={t('speech.examples')} />
                    <View style={speechLayout.chips}>{TTS_EXAMPLES.map((example, index) => <Chip key={example.title} label={t(`speech.example.${index}`)} onPress={() => editScript(example.text)} />)}</View>
                    <InsertBar onInsert={cue => { const next = insertCue(script, cue); if (next.tooLong) setError(t('speech.tooLong')); else editScript(next.script); }} />
                    <VoicePicker value={settings.voice} onChange={voice => editSettings({ ...settings, voice })} board={voices} onToggle={voice => editVoices(toggleAuditionVoice(voices, voice))} onTest={testVoice} />
                    <AuditionBoard voices={voices} onRemove={voice => editVoices(toggleAuditionVoice(voices, voice))} onClear={() => editVoices([])} />
                    <SpeechControls value={settings} onChange={editSettings} />
                </View>
                {error && <Text tone="danger" accessibilityRole="alert" accessibilityLiveRegion="polite">{error}</Text>}
                <SpeechPricePanel price={boardActive ? price : quote.total} audition={boardActive ? { count, unit, remaining: showRemaining ? quote.total : null } : undefined} payable={quote.payable} balance={balance} disabled={!!validation || restored.loading} busy={busy} onGenerate={() => { restored.dismiss(); void generate(request, model, voices, quote, balance); }} onCredits={() => router.push('/credits')} />
                {jobs.length > 0 && <AuditionResults api={api} jobs={jobs} modelId={model.id} catalog={catalog ?? []} onTerminal={settled} />}
            </>}
        </KeyboardFormScrollView>
    </KeyboardScreen>;
}
const sheets = themedStyles(p => ({ screen: { flex: 1, backgroundColor: p.bg }, body: { padding: 16, gap: 20, paddingBottom: 40 }, script: { minHeight: 140, textAlignVertical: 'top' } }));
