import { useEffect, useState } from 'react';
import { Stack, useRouter } from 'expo-router';
import { useAuth } from '../../auth/AuthProvider';
import { Button, Text, themedStyles, useThemedStyles } from '../ui';
import { KeyboardScreen } from '../KeyboardScreen';
import { KeyboardFormScrollView } from '../KeyboardFormScrollView';
import { CreateResult } from '../create/CreateResult';
import { ModelUnavailable } from '../create/ModelUnavailable';
import { SpeechLabel } from '../speech/SpeechFields';
import { useSpeechSubmission } from '../speech/useSpeechSubmission';
import { fetchCatalog, estimateCredits, type CatalogModel } from '../../lib/media';
import { useBalance } from '../../lib/useBalance';
import { useAnnouncement } from '../../lib/useAnnouncement';
import { plural, t } from '../../lib/i18n';
import { addDialogueTurn, removeDialogueTurn, emptyDialogueTurns, normalizeDialogueTurns, buildDialogueRequest, dialogueModel, validateDialogue } from '../../lib/speech/dialogue';
import { compileDialogueTurns, estimatedDialogueSeconds, MAX_DIALOGUE_CHARS, MAX_DIALOGUE_TURNS, moveDialogueTurn,
    validateDialogueTurns } from '../../lib/speech/dialogueShared';
import { useDialogueEditor } from './useDialogueEditor';
import { TurnCard } from './TurnCard';
import { CastMap } from './CastMap';
import { DialoguePricePanel } from './DialoguePricePanel';

export function DialogueStudio({ reopen }: { reopen?: string | string[] }) {
    const { api } = useAuth(), router = useRouter(), styles = useThemedStyles(sheets), balance = useBalance();
    const [catalog, setCatalog] = useState<CatalogModel[] | null>(null), [catalogError, setCatalogError] = useState<string | null>(null);
    const submission = useSpeechSubmission(api, () => {});
    const { pending, sending, busy, result, error, priceFor, resetAttempt, editAttempt, generate, settled } = submission;
    const editor = useDialogueEditor({ reopen, blocked: () => sending.current, editAttempt, resetAttempt,
        markReopened: jobId => pending.current.markDelivered(jobId) });
    const { turns, assignments, turnEdited, restored, editTurns, editTurn, chooseVoice, resetCast } = editor;
    useEffect(() => {
        let live = true;
        void fetchCatalog().then(rows => { if (live) setCatalog(rows); }).catch(() => { if (live) setCatalogError(t('form.modelLoad')); });
        return () => { live = false; };
    }, []);
    useAnnouncement(error ?? (busy ? t('dialogue.submitting') : result ? t('dialogue.accepted') : null));
    const clean = normalizeDialogueTurns(turns), disabled = busy || restored.loading;
    const model = dialogueModel(catalog ?? []);
    if (!model) return <ModelUnavailable title={t('dialogue.title')} fromTemplate={false}
        recovery={{ label: t('dialogue.back'), onPress: () => router.canGoBack() ? router.back() : router.replace('/audio') }}
        error={catalogError ?? (catalog ? t('form.modelGone') : null)} />;
    const validation = validateDialogue(turns, assignments);
    const unpriced = validation ? null : buildDialogueRequest(turns, assignments, model);
    const unit = priceFor(unpriced, 1) ?? estimateCredits(model, null);
    const request = unpriced ? { ...unpriced, confirmedCredits: unit } : null;
    const quote = request ? pending.current.snapshot(request, 1, unit, 0) : { total: unit, payable: unit, ceilings: [unit] };
    return <KeyboardScreen style={styles.screen}>
        <Stack.Screen options={{ title: t('dialogue.title') }} />
        <KeyboardFormScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
            <SpeechLabel icon="chatsCircle" label={t('dialogue.title')} />
            <Text tone="secondary">{t('dialogue.intro')}</Text>
            {restored.unavailable && <Text accessibilityLiveRegion="polite">{t('dialogue.restoreUnavailable')}</Text>}
            {result ? <><Text accessibilityLiveRegion="polite">{t('dialogue.accepted')}</Text>
                <CreateResult api={api} batch={result} catalog={catalog ?? []} onTerminal={settled} />
                <Button label={t('dialogue.adjust')} disabled={busy} onPress={resetAttempt} /></> : <>
                {turns.map((turn, index) => <TurnCard key={index} turn={turn} index={index} count={turns.length} disabled={disabled}
                    voice={assignments.find(item => item.speaker.toLowerCase() === turn.speaker.trim().toLowerCase())?.voice ?? t('dialogue.noVoice')}
                    onChange={next => editTurn(index, next)}
                    onMove={direction => editTurns(moveDialogueTurn(turns, index, direction))} onRemove={() => editTurns(removeDialogueTurn(turns, index))} />)}
                <Button icon="plus" variant="secondary" label={t('dialogue.add')} disabled={disabled || turns.length >= MAX_DIALOGUE_TURNS} onPress={() => editTurns(addDialogueTurn(turns))} />
                <Button variant="secondary" label={t('dialogue.clear')} disabled={disabled} onPress={() => editTurns(emptyDialogueTurns())} />
                <Text>{plural('dialogue.characters', compileDialogueTurns(clean).length, { max: MAX_DIALOGUE_CHARS })}</Text>
                <Text>{plural('dialogue.seconds', estimatedDialogueSeconds(clean))}</Text>
                <Text>{plural('dialogue.speakers', validateDialogueTurns(clean).speakers.length)}</Text>
                <CastMap assignments={assignments} disabled={disabled} onChange={chooseVoice}
                    onReset={resetCast} />
                {validation && (validation !== 'dialogue.wordsRequired' || turnEdited) && <Text tone="danger" accessibilityLiveRegion="polite">{t(validation)}</Text>}
                {error && <Text tone="danger" accessibilityRole="alert" accessibilityLiveRegion="polite">{error}</Text>}
                <DialoguePricePanel price={quote.total} payable={quote.payable} balance={balance} busy={busy} disabled={!!validation || restored.loading}
                    onGenerate={() => { restored.dismiss(); void generate(request, model, [], quote, balance); }} onCredits={() => router.push('/credits')} />
            </>}
        </KeyboardFormScrollView>
    </KeyboardScreen>;
}
const sheets = themedStyles(p => ({ screen: { flex: 1, backgroundColor: p.bg }, body: { padding: 16, gap: 20, paddingBottom: 40 } }));
