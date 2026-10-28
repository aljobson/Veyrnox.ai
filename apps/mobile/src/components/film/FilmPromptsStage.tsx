import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { ACCEPTANCE_CHECKS, PROMPT_DETAILS, buildShotPrompt, failedAttempts, latestPrompt, logFilmAttempt, nextPromptVersion, promptContext } from '../../lib/filmStudio';
import { displayLabel } from '../../lib/displayLabels';
import { t } from '../../lib/i18n';
import { colors } from '../../theme';
import { FilmSelect } from './FilmSelect';
import { FilmAction, FilmInput, FilmPromptOutput, type StageProps } from './FilmPromptOutput';
import { Text as StatusText } from '../ui/Text';

export function FilmPromptsStage({ film, change, catalog, live }: StageProps) {
    const router = useRouter();
    const [selected, setSelected] = useState(''), [details, setDetails] = useState<Record<string, string>>({});
    const [revision, setRevision] = useState<string | null>(null), [result, setResult] = useState('');
    const [changed, setChanged] = useState(t('filmOutput.first')), [verdict, setVerdict] = useState<'accepted' | 'rejected'>('rejected');
    const [checks, setChecks] = useState<string[]>([]), [error, setError] = useState('');
    const shot = film.shots.find(s => s.id === selected) ?? film.shots[0];
    if (!shot) return <Text>{t('film.addashotinstage3first')}</Text>;
    const last = latestPrompt(film, shot.id), current = last?.context === promptContext(film, shot);
    const logged = last && film.attempts.some(a => a.shot === shot.id && a.version === last.version);
    const failed = failedAttempts(film, shot);
    const build = (revised: boolean) => {
        try {
            const prompt = nextPromptVersion(film, shot, revised ? revision! : buildShotPrompt(film, shot, details));
            change({ ...film, prompts: [...film.prompts, prompt] }); setRevision(null); setError(''); setResult(''); setChecks([]);
            setChanged(t(revised ? 'filmOutput.revised' : 'filmOutput.first'));
        } catch (e) { setError((e as Error).message); }
    };
    return <View style={{ gap: 16 }}>
        <FilmSelect label={t('film.shot')} value={shot.id} options={film.shots.map(s => ({ value: s.id, label: s.id }))} onChange={v => {
            setSelected(v); setDetails({}); setRevision(null); setResult(''); setChanged(t('filmOutput.first')); setVerdict('rejected'); setChecks([]); setError('');
        }} />
        {!current ? <>
            {last ? <Text style={{ color: colors.muted }}>{t('filmOutput.stale')}</Text> : null}
            {PROMPT_DETAILS.map(([key, label]) => <FilmInput key={key} label={label} value={details[key] ?? ''} multiline onChange={v => setDetails(d => ({ ...d, [key]: v }))} />)}
            <FilmAction label={t('film.build15blockprompt')} onPress={() => build(false)} />
        </> : last ? <>
            <StatusText variant="inherit" accessibilityLiveRegion="polite" style={{ color: colors.body }}>{t('filmOutput.version', { value1: shot.id, value2: last.version, value3: t(logged ? 'filmOutput.logged' : 'filmOutput.ready') })}</StatusText>
            <FilmPromptOutput title={t('filmOutput.output')} prompt={last.content} modelId={film.stack.video} access={logged ? 'External' : film.stack.videoAccess} catalog={catalog} live={live} aspect={film.stack.aspect} duration={Number(shot.seconds)} />
            {!logged ? <View style={{ gap: 12 }}>
                <Text accessibilityRole="header" style={{ color: colors.text }}>{t('film.lOGTHEGENERATEDTAKE')}</Text>
                <FilmInput label={t('film.whatchangedforthisversion')} value={changed} onChange={setChanged} />
                <FilmInput label={t('film.resultfileorLibraryreference')} value={result} onChange={setResult} />
                <FilmSelect label={t('filmOutput.verdict')} value={verdict} options={['rejected', 'accepted'].map(value => ({ value, label: displayLabel(value) }))} onChange={v => setVerdict(v as typeof verdict)} />
                {verdict === 'accepted' ? ACCEPTANCE_CHECKS.map(check => <Pressable key={check} accessibilityRole="checkbox" accessibilityState={{ checked: checks.includes(check) }} style={{ minHeight: 44, justifyContent: 'center' }} onPress={() => setChecks(c => c.includes(check) ? c.filter(v => v !== check) : [...c, check])}><Text style={{ color: colors.body }}>{displayLabel(check)}</Text></Pressable>) : null}
                <FilmAction label={t('filmOutput.record')} disabled={!changed.trim() || !result.trim()} onPress={() => {
                    try { change(logFilmAttempt(film, last, { result, changed, verdict, checks })); setResult(''); setChecks([]); setError(''); }
                    catch (e) { setError((e as Error).message); }
                }} />
            </View> : failed < 15 ? <>
                <FilmInput label={t('filmOutput.revise')} value={revision ?? last.content} multiline onChange={setRevision} />
                <FilmAction label={t('filmOutput.saveRevision')} disabled={revision === null} onPress={() => build(true)} />
            </> : null}
        </> : null}
        <FilmAction label={t('filmOutput.openShot')} onPress={() => router.push({ pathname: '/film/shot/[id]', params: { id: shot.id } })} />
        {failed >= 15 ? <StatusText variant="inherit" accessibilityRole="alert" style={{ color: colors.body }}>{t('filmWorkspace.fifteenMisses')}</StatusText> : null}
        {error ? <StatusText variant="inherit" accessibilityRole="alert" style={{ color: colors.danger }}>{error}</StatusText> : null}
        {film.attempts.filter(a => a.shot === shot.id).map(a => <View key={a.version}><Text style={{ color: colors.body }}>{t('film.version', { value1: a.version, value2: displayLabel(a.verdict) })} · {a.changed}</Text><Text selectable style={{ color: colors.muted }}>{a.result}</Text></View>)}
    </View>;
}
