import { File } from 'expo-file-system';
import { randomUUID } from 'expo-crypto';
import * as DocumentPicker from 'expo-document-picker';
import { Stack } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Platform, View } from 'react-native';
import { useAuth } from '../../../auth/AuthProvider';
import { MfaCard } from '../../../components/account/MfaCard';
import { SafeKeyboardFormScrollView } from '../../../components/SafeContentScrollView';
import { Button, Card, Checkbox, Text, TextField, themedStyles, useThemedStyles } from '../../../components/ui';
import { ApiError } from '../../../lib/api';
import { discardCacheCopy } from '../../../lib/cacheFiles';
import { discardTake } from '../../../lib/editorVoiceoverTakes';
import { t } from '../../../lib/i18n';
import { uploadSource } from '../../../lib/uploads';
import {
    enrollMusicVoice, listMusicVoices, reissueMusicVoiceChallenge, revokeMusicVoice,
    submitMusicVoiceChallenge, type MusicVoiceChallenge, type MusicVoiceProfile,
} from '../../../lib/music/voices';
import {
    VOICEOVER_AVAILABLE, VOICEOVER_OPTIONS, getRecordingPermissionsAsync, requestRecordingPermissionsAsync,
    setAudioModeAsync, useAudioRecorder, useAudioRecorderState,
} from '../../../lib/voiceoverRecorder';
import { ds } from '../../../theme';

type Reference = { readonly uri: string; readonly size: number; readonly type: 'audio/mpeg' | 'audio/wav'; readonly name: string; readonly durationSeconds?: number };
type PendingAttempts = {
    enroll?: { readonly referenceKey: string; readonly name: string; readonly idempotencyKey: string };
    reissue?: { readonly profileId: string; readonly idempotencyKey: string };
    submit?: { readonly profileId: string; readonly challengeKey: string; readonly phrase: string; readonly idempotencyKey: string };
    revoke?: { readonly profileId: string; readonly idempotencyKey: string };
};
const normalType = (value: string | null | undefined) => ['audio/x-wav', 'audio/wave'].includes(value || '') ? 'audio/wav' : value;
const failureKey = (error: unknown) => {
    const code = error instanceof ApiError ? error.code : 'unknown';
    return ({ recent_mfa_required: 'musicVoices.error.mfa', mfa_required: 'musicVoices.error.mfa', active_profile: 'musicVoices.error.active',
        challenge_expired: 'musicVoices.error.expired', challenge_mismatch: 'musicVoices.error.mismatch',
        source_invalid: 'musicVoices.error.source', music_voices_unavailable: 'musicVoices.error.unavailable', reissue_limit: 'musicVoices.error.reissue',
        rate_limited: 'musicVoices.error.rate' } as Record<string, string>)[code]
        || 'musicVoices.error.unknown';
};

export default function MusicVoicesScreen() {
    const { api } = useAuth(); const s = useThemedStyles(sheets);
    const [profiles, setProfiles] = useState<readonly MusicVoiceProfile[]>([]);
    const [enrollmentAvailable, setEnrollmentAvailable] = useState(false);
    const [name, setName] = useState(''); const [reference, setReference] = useState<Reference | null>(null);
    const [owner, setOwner] = useState(false); const [adult, setAdult] = useState(false); const [region, setRegion] = useState(false);
    const [challenge, setChallenge] = useState<MusicVoiceChallenge | null>(null);
    const [take, setTake] = useState<Reference | null>(null); const [busy, setBusy] = useState(''); const [error, setError] = useState('');
    const live = useRef(true); const referenceUri = useRef<string | null>(null); const takeUri = useRef<string | null>(null);
    const attempts = useRef<PendingAttempts>({});
    const controllers = useRef(new Set<AbortController>()); const recorder = useAudioRecorder(VOICEOVER_OPTIONS); const recorderState = useAudioRecorderState(recorder, 100);
    const changeReference = (next: Reference | null) => { const previous = referenceUri.current; referenceUri.current = next?.uri || null; setReference(next);
        if (previous !== next?.uri) { delete attempts.current.enroll; discardCacheCopy(previous); } };
    const changeTake = (next: Reference | null) => { const previous = takeUri.current; takeUri.current = next?.uri || null; setTake(next);
        if (previous !== next?.uri) { delete attempts.current.submit; discardTake(previous); } };
    const upload = async (source: { readonly uri: string; readonly size: number }, type: 'audio/mpeg' | 'audio/wav') => {
        const controller = new AbortController(); controllers.current.add(controller);
        try { return await uploadSource(api, source, type, () => {}, controller.signal, undefined, 'music_voice_evidence'); } finally { controllers.current.delete(controller); }
    };
    const active = profiles.find(item => ['challenge_issued', 'pending_review', 'verified'].includes(item.status)) || null;
    const terminal = !active ? profiles.find(item => ['rejected', 'revoked', 'expired'].includes(item.status)) || null : null;
    const load = useCallback(async () => { try { const next = await listMusicVoices(api); if (live.current) { setProfiles(next.profiles); setEnrollmentAvailable(next.enrollmentAvailable); setError(''); } }
        catch (next) { if (live.current) setError(t(failureKey(next))); } }, [api]);
    useEffect(() => {
        live.current = true; const pendingControllers = controllers.current;
        // Load only after the account-bound native client is mounted.
        // eslint-disable-next-line react-hooks/set-state-in-effect
        void load();
        return () => { live.current = false; pendingControllers.forEach(controller => controller.abort()); pendingControllers.clear();
            discardCacheCopy(referenceUri.current); referenceUri.current = null; discardTake(takeUri.current); takeUri.current = null;
            try { void recorder.stop(); } catch {} void setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true }).catch(() => {}); };
    }, [load, recorder]);
    async function run(label: string, action: () => Promise<void>) { setBusy(label); setError(''); try { await action(); } catch (next) { if (live.current) setError(t(failureKey(next))); } finally { if (live.current) setBusy(''); } }
    async function pickReference() {
        const picked = await DocumentPicker.getDocumentAsync({ type: ['audio/mpeg', 'audio/wav', 'audio/x-wav', 'audio/wave'], copyToCacheDirectory: true });
        if (picked.canceled) return; const item = picked.assets[0]; const type = normalType(item.mimeType);
        if ((type !== 'audio/mpeg' && type !== 'audio/wav') || !Number.isSafeInteger(item.size) || !item.size || item.size > 20 * 1024 * 1024) {
            discardCacheCopy(item.uri); setError(t('musicVoices.error.choose')); return;
        }
        changeReference({ uri: item.uri, size: item.size, type, name: item.name }); setError('');
    }
    async function pickTake() {
        const picked = await DocumentPicker.getDocumentAsync({ type: ['audio/mpeg', 'audio/wav', 'audio/x-wav', 'audio/wave'], copyToCacheDirectory: true });
        if (picked.canceled) return; const item = picked.assets[0]; const type = normalType(item.mimeType);
        if ((type !== 'audio/mpeg' && type !== 'audio/wav') || !Number.isSafeInteger(item.size) || !item.size || item.size > 20 * 1024 * 1024) {
            discardCacheCopy(item.uri); setError(t('musicVoices.error.choose')); return;
        }
        changeTake({ uri: item.uri, size: item.size, type, name: item.name }); setError('');
    }
    async function enroll() {
        if (!reference) return;
        await run('enroll', async () => { let attempt = attempts.current.enroll;
            if (!attempt) { const referenceKey = await upload(reference, reference.type);
                attempt = { referenceKey, name: name.trim(), idempotencyKey: `music-voice-enroll-${randomUUID()}` }; attempts.current.enroll = attempt; }
            const result = await enrollMusicVoice(api, attempt); delete attempts.current.enroll;
            if (!live.current) return; setChallenge(result.challenge); setName(''); changeReference(null); await load(); });
    }
    async function reissue() { if (!active) return; await run('challenge', async () => { let attempt = attempts.current.reissue;
        if (!attempt || attempt.profileId !== active.id) { attempt = { profileId: active.id, idempotencyKey: `music-voice-reissue-${randomUUID()}` }; attempts.current.reissue = attempt; }
        const result = await reissueMusicVoiceChallenge(api, active.id, attempt.idempotencyKey); delete attempts.current.reissue;
        if (live.current) setChallenge(result); await load(); }); }
    async function startRecording() {
        if (!VOICEOVER_AVAILABLE || Platform.OS !== 'ios') return;
        await run('record', async () => { let permission = await getRecordingPermissionsAsync(); if (!permission.granted && permission.canAskAgain) permission = await requestRecordingPermissionsAsync();
            if (!permission.granted) { Alert.alert(t('musicVoices.microphoneTitle'), t('musicVoices.microphoneBody')); return; }
            changeTake(null); await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true }); await recorder.prepareToRecordAsync(); recorder.record({ forDuration: 60 }); });
    }
    async function stopRecording() { await run('stop', async () => { await recorder.stop(); await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true });
        if (live.current && recorder.uri) { const file = new File(recorder.uri); if (!Number.isSafeInteger(file.size) || file.size < 1) throw new ApiError(400, 'source_invalid');
            changeTake({ uri: recorder.uri, size: file.size, type: 'audio/wav', name: 'challenge.wav', durationSeconds: duration }); } }); }
    async function submit() {
        if (!active || !challenge || !take) return;
        await run('submit', async () => { if (!Number.isSafeInteger(take.size) || take.size < 1) throw new ApiError(400, 'source_invalid');
            let attempt = attempts.current.submit;
            if (!attempt || attempt.profileId !== active.id) { const challengeKey = await upload(take, take.type);
                attempt = { profileId: active.id, challengeKey, phrase: challenge.phrase, idempotencyKey: `music-voice-submit-${randomUUID()}` }; attempts.current.submit = attempt; }
            await submitMusicVoiceChallenge(api, active.id, attempt); delete attempts.current.submit;
            if (!live.current) return; changeTake(null); setChallenge(null); await load(); });
    }
    function confirmRevoke() { if (!active) return; Alert.alert(t('musicVoices.revokeTitle'), t('musicVoices.revokeBody'), [
        { text: t('musicVoices.cancel'), style: 'cancel' }, { text: t('musicVoices.revoke'), style: 'destructive', onPress: () => void run('revoke', async () => {
            let attempt = attempts.current.revoke;
            if (!attempt || attempt.profileId !== active.id) { attempt = { profileId: active.id, idempotencyKey: `music-voice-revoke-${randomUUID()}` }; attempts.current.revoke = attempt; }
            await revokeMusicVoice(api, active.id, attempt.idempotencyKey); delete attempts.current.revoke;
            if (live.current) { changeTake(null); setChallenge(null); } await load(); }) },
    ]); }
    const duration = Math.floor((recorderState.durationMillis || 0) / 1000);

    return <SafeKeyboardFormScrollView style={s.screen} contentContainerStyle={s.content} gutter={ds.space.lg}>
        <Stack.Screen options={{ title: t('musicVoices.title') }} />
        <View style={s.intro}><Text variant="display">{t('musicVoices.eyebrow')}</Text><Text variant="body" tone="secondary">{t('musicVoices.intro')}</Text></View>
        <MfaCard />
        {terminal ? <Card testID={`music-voice-${terminal.status}`} style={s.group}>
            <Text variant="footnote" tone="accent">{t('musicVoices.statusPrevious')}</Text>
            <Text variant="title2">{t(terminal.status === 'rejected' ? 'musicVoices.statusRejected'
                : terminal.status === 'revoked' ? 'musicVoices.statusRevoked' : 'musicVoices.statusExpired')}</Text>
            <Text variant="body" tone="secondary">{terminal.status === 'rejected'
                ? t('musicVoices.statusRejectedBody', { reason: String(terminal.reason_code || 'policy_failed').replaceAll('_', ' ') })
                : t(terminal.status === 'revoked' ? 'musicVoices.statusRevokedBody' : 'musicVoices.statusExpiredBody')}</Text>
        </Card> : null}
        {!active && enrollmentAvailable ? <Card style={s.group}><Text variant="title2">{t('musicVoices.addTitle')}</Text><Text variant="body" tone="secondary">{t('musicVoices.addBody')}</Text>
            <TextField label={t('musicVoices.name')} value={name} maxLength={80} onChangeText={setName} testID="music-voice-name" />
            <Button variant="secondary" icon="audio" label={reference ? t('musicVoices.selected', { name: reference.name }) : t('musicVoices.choose')} onPress={() => void pickReference()} testID="music-voice-reference" />
            <Checkbox checked={owner} onChange={setOwner}><Text>{t('musicVoices.owner')}</Text></Checkbox>
            <Checkbox checked={adult} onChange={setAdult}><Text>{t('musicVoices.adult')}</Text></Checkbox>
            <Checkbox checked={region} onChange={setRegion}><Text>{t('musicVoices.region')}</Text></Checkbox>
            <Button label={t('musicVoices.start')} loading={busy === 'enroll'} disabled={Boolean(busy) || !name.trim() || !reference || !owner || !adult || !region} onPress={() => void enroll()} testID="music-voice-enroll" />
        </Card> : null}
        {!active && !enrollmentAvailable ? <Card testID="music-voice-enrollment-paused" style={s.group}>
            <Text variant="title2">{t('musicVoices.pausedTitle')}</Text><Text variant="body" tone="secondary">{t('musicVoices.pausedBody')}</Text>
        </Card> : null}
        {active?.status === 'challenge_issued' ? <Card style={s.group}><Text variant="title2">{t('musicVoices.challengeTitle')}</Text>
            {!challenge ? <><Text variant="body" tone="secondary">{t('musicVoices.hiddenPhrase')}</Text><Button label={t('musicVoices.issuePhrase')} loading={busy === 'challenge'} disabled={Boolean(busy)} onPress={() => void reissue()} testID="music-voice-new-challenge" /></>
                : <><View style={s.phrase}><Text variant="title2" selectable testID="music-voice-phrase">{challenge.phrase}</Text></View><Text variant="body" tone="secondary">{t('musicVoices.phraseBody')}</Text>
                    {VOICEOVER_AVAILABLE && Platform.OS === 'ios' ? (!recorderState.isRecording ? <Button icon="microphone" label={t(take ? 'musicVoices.recordAgain' : 'musicVoices.recordStart')} disabled={Boolean(busy)} onPress={() => void startRecording()} testID="music-voice-record" />
                        : <Button variant="destructive" label={t('musicVoices.recordStop', { seconds: duration })} onPress={() => void stopRecording()} testID="music-voice-stop" />)
                        : <Button variant="secondary" icon="audio" label={take ? t('musicVoices.selected', { name: take.name }) : t('musicVoices.choose')} disabled={Boolean(busy)} onPress={() => void pickTake()} testID="music-voice-recording-file" />}
                    {take?.durationSeconds !== undefined ? <Text variant="footnote" tone="secondary">{t('musicVoices.recordReady', { seconds: take.durationSeconds })}</Text> : null}
                    <Button label={t('musicVoices.submit')} loading={busy === 'submit'} disabled={Boolean(busy) || !take || (take.durationSeconds !== undefined && take.durationSeconds < 2)} onPress={() => void submit()} testID="music-voice-submit" /></>}
        </Card> : null}
        {active?.status === 'pending_review' ? <Card testID="music-voice-pending" style={s.group}><Text variant="title2">{t('musicVoices.pendingTitle')}</Text><Text variant="body" tone="secondary">{t('musicVoices.pendingBody')}</Text></Card> : null}
        {active?.status === 'verified' ? <Card testID="music-voice-verified" style={s.group}><Text variant="title2">{t('musicVoices.verifiedTitle', { name: active.name })}</Text><Text variant="body" tone="secondary">{t('musicVoices.verifiedBody')}</Text></Card> : null}
        {error ? <Text variant="body" tone="danger" accessibilityRole="alert">{error}</Text> : null}
        {active ? <Card style={s.group}><Text variant="title2">{t('musicVoices.privacyTitle')}</Text><Text variant="body" tone="secondary">{t('musicVoices.privacyBody')}</Text><Button variant="destructive" label={t('musicVoices.revoke')} loading={busy === 'revoke'} disabled={Boolean(busy)} onPress={confirmRevoke} testID="music-voice-revoke" /></Card> : null}
    </SafeKeyboardFormScrollView>;
}

const sheets = themedStyles(p => ({ screen: { flex: 1, backgroundColor: p.bg }, content: { gap: ds.space.lg }, intro: { gap: ds.space.sm }, group: { gap: ds.space.md }, phrase: { padding: ds.space.lg, borderRadius: ds.radius.md, backgroundColor: p.accentSubtle, borderWidth: 1, borderColor: p.accent } }));
