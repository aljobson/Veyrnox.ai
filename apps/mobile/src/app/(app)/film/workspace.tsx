import { displayLabel } from '../../../lib/displayLabels';
import { plural, t } from '../../../lib/i18n';
import { Button } from '../../../components/ui';
import { Field, Choices } from '../../../components/film/FilmFields';
import { FilmSetupStage } from '../../../components/film/FilmSetupStage';
import { FilmBreakdownStage } from '../../../components/film/FilmBreakdownStage';
import { FilmBoardsStage } from '../../../components/film/FilmBoardsStage';
import { useFilmAutosave } from '../../../components/film/useFilmAutosave';
import { useEditorLeaveGuard } from '../../../components/editor/useEditorLeaveGuard';
import { appCache, getCacheUser, subscribeCacheUser } from '../../../lib/appCache';
import { fetchCatalogCached, type CatalogModel } from '../../../lib/media';
import { randomUUID } from 'expo-crypto';
import { Stack, useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useAuth } from '../../../auth/AuthProvider';
import { ApiError } from '../../../lib/api';
import { ACCEPTANCE_CHECKS, accessibleStage, assetKey, assetType, buildShotPrompt, emptyFilm, FILM_STAGES, isLocked, latestPrompt, lockAsset, logFilmAttempt, nextPromptVersion, PROMPT_DETAILS, shotAssets, stageIssues, testMatrix, type Asset, type Film } from '../../../lib/filmStudio';
import { clearOpenedFilm, cloudStatus, getActiveCloudLink, loadActiveStudio, saveActiveStudioToCloud } from '../../../lib/filmCloud';
import { clearStudio } from '../../../lib/filmStudioStore';
import { colors, fonts } from '../../../theme';

const requiredAssets = (film: Film): string[] => [...new Set(film.shots.flatMap(shotAssets))];

export default function FilmWorkspace() {
    const { api } = useAuth();
    const router = useRouter();
    const [film, setFilm] = useState<Film | null>(null);
    const [stage, setStage] = useState(0);
    const latestFilm = useRef<Film | null>(null);
    const [busy, setBusy] = useState(false);
    const [note, setNote] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
    const [binding, setBinding] = useState<{ owner: string | undefined; generation: number } | null>(null);
    const generation = useRef(0);
    const [catalog, setCatalog] = useState<CatalogModel[]>([]);
    const [live, setLive] = useState(false);
    const [unavailable, setUnavailable] = useState(false);
    const [catalogTry, setCatalogTry] = useState(0);
    const autosave = useFilmAutosave();
    const { cancel, flush, schedule } = autosave;
    const valid = () => binding !== null && binding.owner === getCacheUser() && binding.generation === generation.current;

    useFocusEffect(useCallback(() => () => { void flush().catch(() => undefined); }, [flush]));
    useEditorLeaveGuard(useCallback(async () => {
        const owner = getCacheUser(), session = generation.current;
        const sameSession = () => owner === getCacheUser() && session === generation.current;
        try { await flush(); return sameSession(); }
        catch {
            if (!sameSession()) return false;
            return new Promise<boolean>(resolve => Alert.alert(t('filmWorkspace.leaveTitle'), t('filmWorkspace.leaveBody'), [
                { text: t('filmWorkspace.stay'), style: 'cancel', onPress: () => resolve(false) },
                { text: t('filmWorkspace.leave'), style: 'destructive', onPress: () => { if (!sameSession()) return resolve(false); cancel(); resolve(true); } },
            ], { cancelable: false }));
        }
    }, [flush, cancel]), () => router.back());
    useEffect(() => {
        const load = () => {
            const owner = getCacheUser(), session = generation.current;
            const apply = (next: Film) => {
                if (owner !== getCacheUser() || session !== generation.current) return;
                setBinding({ owner, generation: session }); latestFilm.current = next; setFilm(next);
                setStage(current => Math.min(current, accessibleStage(next)));
            };
            loadActiveStudio().then(saved => apply(saved?.film ?? emptyFilm()), () => apply(emptyFilm()));
        };
        const unsubscribe = subscribeCacheUser(() => {
            generation.current++; cancel(); latestFilm.current = null; setBinding(null); setFilm(null); setNote(null); setBusy(false); load();
        });
        load();
        return () => { unsubscribe(); generation.current++; };
    }, [cancel]);
    useEffect(() => {
        let active = true;
        setUnavailable(false);
        const apply = (models: CatalogModel[]) => { if (active) { setCatalog(models); setLive(true); } };
        fetchCatalogCached(apply).then(result => apply(result.value), () => { if (active) setUnavailable(true); });
        return () => { active = false; };
    }, [catalogTry]);

    const change = (next: Film) => {
        if (!valid()) return;
        latestFilm.current = next; setFilm(next); setNote(null); schedule(next, valid);
    };
    async function save() {
        if (!film || busy || !valid()) return;
        setBusy(true); setNote(null);
        try {
            await flush();
            if (!valid()) return;
            {
                try {
                    const snapshot = latestFilm.current;
                    if (!snapshot) return;
                    const project = await saveActiveStudioToCloud(api, snapshot, randomUUID());
                    if (valid()) setNote({ kind: 'ok', text: t('film.savedtoyouraccountrevision', { value1: project.revision }) });
                } catch (error) {
                    const status = cloudStatus(error);
                    const message = error instanceof ApiError && error.status === 409
                        ? t('film.thisfilmchangedelsewhereYoureditis')
                        : status === 'offline'
                            ? t('film.youreofflineYourfilmissaved')
                            : status === 'busy'
                                ? t('film.accountsavingisbusyYourfilmis')
                                : status === 'unavailable'
                                    ? t('film.accountsavingisnotavailablerightnow')
                                    : t('film.yourfilmissavedonthisphone');
                    if (valid()) setNote({ kind: 'error', text: message });
                }
            }
        } catch (error) {
            if (valid()) setNote({ kind: 'error', text: error instanceof Error && error.message ? error.message : t('film.couldnotsavethestudio') });
        } finally { if (valid()) setBusy(false); }
    }

    function newFilm() {
        if (!valid() || !binding) return;
        const owner = binding.owner, session = binding.generation;
        const current = () => owner === getCacheUser() && session === generation.current;
        Alert.alert(t('film.startanewfilm2'), t('film.thestudiocurrentlyopenonthisphone'), [
            { text: t('film.cancel'), style: 'cancel' },
            { text: t('film.startnew'), style: 'destructive', onPress: async () => {
                if (!current()) return;
                cancel(); clearOpenedFilm(); latestFilm.current = null; setFilm(null); setBinding(null);
                const nextGeneration = ++generation.current;
                await clearStudio(appCache, owner);
                if (owner !== getCacheUser() || nextGeneration !== generation.current) return;
                const next = emptyFilm();
                setBinding({ owner, generation: nextGeneration }); latestFilm.current = next; setFilm(next); setStage(0); setNote(null); setBusy(false);
                schedule(next, () => owner === getCacheUser() && nextGeneration === generation.current);
            } },
        ]);
    }

    if (!film) return <ActivityIndicator style={{ flex: 1 }} color={colors.accent} />;
    const available = accessibleStage(film);
    const issues = stageIssues(film, stage);
    return (
        <View style={styles.screen}>
            <Stack.Screen options={{ title: film.name || t('film.filmStudioworkspace') }} />
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.stageBar} contentContainerStyle={styles.stageBarContent}>
                {FILM_STAGES.map(([, title], index) => {
                    const open = stageIssues(film, index).length;
                    return <Pressable key={title} accessibilityRole="tab" accessibilityLabel={title} disabled={index > available} accessibilityState={{ selected: stage === index, disabled: index > available }} style={[styles.stageChip, stage === index && styles.stageChipOn]} onPress={() => setStage(index)}>
                        <Text style={[styles.stageChipText, stage === index && styles.stageChipTextOn]}>{index + 1}. {title}{open ? ` · ${open}` : ' · ✓'}</Text>
                    </Pressable>;
                })}
            </ScrollView>
            <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}>
                <View style={styles.titleRow}>
                    <View style={{ flex: 1 }}><Text style={styles.kicker}>{t('film.sTAGEOF7', { value1: stage + 1 })}</Text><Text style={styles.title} accessibilityRole="header">{FILM_STAGES[stage][1]}</Text></View>
                    <Pressable accessibilityRole="button" style={styles.smallButton} onPress={newFilm}><Text style={styles.smallButtonText}>{t('film.new')}</Text></Pressable>
                </View>
                {issues.length ? <View style={styles.issues}><Text style={styles.issueTitle}>{plural('film.itemsToFinish', issues.length)}</Text>{issues.slice(0, 12).map((issue) => <Text key={issue} style={styles.issue}>• {issue}</Text>)}{issues.length > 12 ? <Text style={styles.issue}>{t('filmWorkspace.notShown', { value1: issues.length - 12 })}</Text> : null}</View> : <Text style={styles.complete}>{t('film.thisstageiscomplete')}</Text>}
                {stage === 0 ? <FilmSetupStage film={film} change={change} catalog={catalog} live={live} unavailable={unavailable} retry={() => setCatalogTry(n => n + 1)} /> : null}
                {stage === 1 ? <Identity film={film} change={change} catalog={catalog} live={live} /> : null}
                {stage === 2 ? <FilmBreakdownStage film={film} change={change} catalog={catalog} live={live} /> : null}
                {stage === 3 ? <FilmBoardsStage film={film} change={change} catalog={catalog} live={live} /> : null}
                {stage === 4 ? <Passports film={film} change={change} catalog={catalog} live={live} /> : null}
                {stage === 5 ? <Tests film={film} change={change} catalog={catalog} live={live} /> : null}
                {stage === 6 ? <Prompts film={film} change={change} catalog={catalog} live={live} router={router} /> : null}
                {stage < 6 ? <Button label={t('filmWorkspace.continue', { value1: FILM_STAGES[stage + 1][1] })} disabled={issues.length > 0} onPress={() => setStage(stage + 1)} /> : null}
                {note ? <Text accessibilityLiveRegion="polite" style={note.kind === 'error' ? styles.error : styles.complete}>{note.text}</Text> : null}
                <View style={styles.saveRow}>
                    <Text accessibilityLiveRegion="polite" style={[styles.help, { flex: 1 }]}>{autosave.status === 'saving' ? t('film.saving') : autosave.status === 'failed' ? t('filmWorkspace.notSaved', { reason: autosave.reason }) : getActiveCloudLink() ? t('filmWorkspace.memorySaved') : t('filmWorkspace.saved')}</Text>
                    <Pressable accessibilityRole="button" accessibilityState={{ disabled: busy }} disabled={busy} style={styles.primary} onPress={() => void save()}><Text style={styles.primaryText}>{t('film.savetoaccount')}</Text></Pressable>
                </View>
            </ScrollView>
        </View>
    );
}

function Identity({ film, change }: Props) {
    return <View style={styles.section}>
        <Field label={t('film.studioname')} value={film.name} onChange={(name) => change({ ...film, name })} maxLength={100} placeholder={t('film.untitledfilm')} />
        <Text style={styles.label}>{t('film.finalruntime')}</Text><Choices values={['30', '60', '90', '120']} selected={String(film.targetSeconds)} onPick={(value) => change({ ...film, targetSeconds: Number(value) })} suffix={t('film.sec')} />
    </View>;
}

function Passports({ film, change }: Props) {
    const required = requiredAssets(film);
    const addMissing = () => change({ ...film, assets: [...film.assets, ...required.filter((key) => !film.assets.some((asset) => assetKey(asset) === key)).map((key) => { const [tag, version] = key.split(':v'); return { tag, version: Number(version), type: assetType(film, key), descriptor: '', references: [], tests: {} }; })] });
    return <View style={styles.section}>
        <Pressable accessibilityRole="button" style={styles.secondary} onPress={addMissing}><Text style={styles.secondaryText}>{t('film.createmissingpassports')}</Text></Pressable>
        {film.assets.map((asset, index) => <View key={assetKey(asset)} style={styles.card}>
            <Text style={styles.cardTitle}>{assetKey(asset)} · {asset.type}{isLocked(film, asset) ? t('film.lOCKED') : ''}</Text>
            <Field label={t('film.canonicaldescriptor')} value={asset.descriptor} multiline onChange={(descriptor) => updateAsset(film, change, index, { ...asset, descriptor })} placeholder={t('film.exactidentityformmaterialcolourwearand')} />
            <Field label={t('film.approvedreferencefiles')} value={asset.references.join('\n')} multiline onChange={(value) => updateAsset(film, change, index, { ...asset, references: value.split('\n').map((line) => line.trim()).filter(Boolean) })} placeholder={t('film.onefileorLibraryreferenceperline')} />
        </View>)}
    </View>;
}

function Tests({ film, change }: Props) {
    const lock = (key: string) => { try { change(lockAsset(film, key)); } catch (error) { Alert.alert(t('film.cannotlockthisasset'), error instanceof Error ? error.message : t('film.finisheverytestfirst')); } };
    return <View style={styles.section}>{film.assets.map((asset, index) => <View key={assetKey(asset)} style={styles.card}>
        <Text style={styles.cardTitle}>{assetKey(asset)} {isLocked(film, asset) ? t('film.lOCKED2') : t('film.dRAFT')}</Text>
        {testMatrix(film, asset).map((row) => { const test = asset.tests[row.id] ?? { result: '', verdict: 'pending' }; return <View key={row.id} style={styles.testRow}>
            <Text style={styles.groupTitle}>{row.id} · {row.angle} · {row.size}{row.pair ? t('film.with', { value1: row.pair }) : ''}</Text>
            <Field label={t('film.actualoutputreference')} value={test.result} onChange={(result) => updateAsset(film, change, index, { ...asset, tests: { ...asset.tests, [row.id]: { ...test, result } } })} />
            <Choices values={['pending', 'pass', 'miss']} selected={test.verdict} onPick={(verdict) => updateAsset(film, change, index, { ...asset, tests: { ...asset.tests, [row.id]: { ...test, verdict } } })} />
        </View>; })}
        <Pressable accessibilityRole="button" style={styles.primary} onPress={() => lock(assetKey(asset))}><Text style={styles.primaryText}>{isLocked(film, asset) ? t('film.locked2') : t('film.lockaftereverytestpasses')}</Text></Pressable>
    </View>)}</View>;
}

function Prompts({ film, change, router }: Props & { router: ReturnType<typeof useRouter> }) {
    const [selected, setSelected] = useState(film.shots[0]?.id ?? '');
    const [details, setDetails] = useState<Record<string, string>>({});
    const [result, setResult] = useState('');
    const [changed, setChanged] = useState('');
    const [verdict, setVerdict] = useState<'accepted' | 'rejected'>('rejected');
    const [checks, setChecks] = useState<string[]>([]);
    const shot = film.shots.find((item) => item.id === selected) ?? film.shots[0];
    const build = () => {
        if (!shot) return;
        try { const prompt = nextPromptVersion(film, shot, buildShotPrompt(film, shot, details)); change({ ...film, prompts: [...film.prompts, prompt] }); }
        catch (error) { Alert.alert(t('film.promptnotready'), error instanceof Error ? error.message : t('film.finishtheearlierstagesfirst')); }
    };
    const log = () => {
        const prompt = shot ? latestPrompt(film, shot.id) : null;
        if (!prompt) return;
        try {
            change(logFilmAttempt(film, prompt, { result, changed, verdict, checks }));
            setResult(''); setChanged(''); setVerdict('rejected'); setChecks([]);
        } catch (error) { Alert.alert(t('film.resultnotrecorded'), error instanceof Error ? error.message : t('film.checkeveryfieldandtryagain')); }
    };
    return <View style={styles.section}>
        {film.shots.length ? <Choices values={film.shots.map((item) => item.id)} selected={shot?.id ?? ''} onPick={setSelected} /> : <Text style={styles.help}>{t('film.addashotinstage3first')}</Text>}
        {shot ? <>
            {PROMPT_DETAILS.map(([key, label]) => <Field key={key} label={label} value={details[key] ?? ''} multiline={key === 'constraints' || key === 'quality'} onChange={(value) => setDetails((current) => ({ ...current, [key]: value }))} />)}
            <Pressable accessibilityRole="button" style={styles.primary} onPress={build}><Text style={styles.primaryText}>{latestPrompt(film, shot.id) ? t('film.createnextpromptversion') : t('film.build15blockprompt')}</Text></Pressable>
            {latestPrompt(film, shot.id) ? <View style={styles.card}>
                <Text style={styles.cardTitle}>{t('film.promptv', { value1: latestPrompt(film, shot.id)?.version ?? '' })}</Text><Text selectable style={styles.prompt}>{latestPrompt(film, shot.id)?.content}</Text>
                <Pressable accessibilityRole="button" style={styles.secondary} onPress={() => router.push({ pathname: '/film/shot/[id]', params: { id: shot.id } })}><Text style={styles.secondaryText}>{t('film.openshotandsendtoCreate')}</Text></Pressable>
                <Text style={styles.groupTitle}>{t('film.lOGTHEGENERATEDTAKE')}</Text>
                <Field label={t('film.resultfileorLibraryreference')} value={result} onChange={setResult} />
                <Field label={t('film.whatchangedforthisversion')} value={changed} onChange={setChanged} multiline />
                <Choices values={['rejected', 'accepted']} selected={verdict} onPick={(value) => setVerdict(value as 'accepted' | 'rejected')} />
                {verdict === 'accepted' ? <View style={styles.section}>{ACCEPTANCE_CHECKS.map((check) => <Pressable key={displayLabel(check)} accessibilityRole="checkbox" accessibilityState={{ checked: checks.includes(check) }} style={[styles.choice, checks.includes(check) && styles.choiceOn]} onPress={() => setChecks((current) => current.includes(check) ? current.filter((item) => item !== check) : [...current, check])}><Text style={styles.choiceText}>{checks.includes(check) ? '✓ ' : ''}{displayLabel(check)}</Text></Pressable>)}</View> : null}
                <Pressable accessibilityRole="button" style={styles.primary} onPress={log}><Text style={styles.primaryText}>{t('film.recordtake', { value1: verdict })}</Text></Pressable>
            </View> : null}
        </> : null}
    </View>;
}

type Props = { film: Film; change: (film: Film) => void; catalog: readonly CatalogModel[]; live: boolean };
function updateAsset(film: Film, change: Props['change'], index: number, asset: Asset) { change({ ...film, assets: film.assets.map((item, i) => i === index ? asset : item) }); }
const styles = StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.background }, stageBar: { flexGrow: 0, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border }, stageBarContent: { paddingHorizontal: 12, paddingVertical: 10, gap: 8 },
    stageChip: { minHeight: 44, justifyContent: 'center', borderRadius: 20, paddingHorizontal: 14, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border }, stageChipOn: { backgroundColor: colors.accent, borderColor: colors.accent }, stageChipText: { color: colors.body, fontSize: 13, fontWeight: '700' }, stageChipTextOn: { color: colors.accentInk },
    content: { padding: 16, paddingBottom: 100, gap: 16 }, titleRow: { flexDirection: 'row', alignItems: 'center', gap: 12 }, kicker: { color: colors.accent, fontSize: 11, fontWeight: '900', letterSpacing: 1.4 }, title: { color: colors.text, fontFamily: fonts.display, fontSize: 26 },
    issues: { gap: 5, borderRadius: 14, borderWidth: 1, borderColor: colors.money, backgroundColor: colors.surface, padding: 14 }, issueTitle: { color: colors.money, fontWeight: '800' }, issue: { color: colors.body, fontSize: 13, lineHeight: 18 }, complete: { color: colors.accent, fontWeight: '700' }, error: { color: colors.danger },
    section: { gap: 14 }, card: { gap: 12, borderRadius: 16, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, padding: 14 }, cardTitle: { color: colors.text, fontSize: 17, fontWeight: '800' }, groupTitle: { color: colors.accent, fontSize: 13, fontWeight: '800' }, fieldGroup: { gap: 10, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border, paddingTop: 12 },
    field: { gap: 6 }, label: { color: colors.body, fontSize: 13, fontWeight: '700' }, input: { minHeight: 46, borderRadius: 12, borderWidth: 1, borderColor: colors.borderStrong, backgroundColor: colors.background, color: colors.text, paddingHorizontal: 12, paddingVertical: 10, fontSize: 16 }, multiline: { minHeight: 110, textAlignVertical: 'top' }, help: { color: colors.muted, fontSize: 13, lineHeight: 19 },
    choices: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 }, choice: { minHeight: 44, justifyContent: 'center', borderRadius: 12, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, paddingHorizontal: 14 }, choiceOn: { borderColor: colors.accent, backgroundColor: colors.accentSoft }, choiceText: { color: colors.body, fontWeight: '600' }, choiceTextOn: { color: colors.accent, fontWeight: '800' },
    testRow: { gap: 8, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border, paddingTop: 12 }, prompt: { color: colors.body, fontSize: 12, lineHeight: 18 }, remove: { color: colors.danger, fontWeight: '700' }, smallButton: { minWidth: 50, minHeight: 44, justifyContent: 'center', alignItems: 'center' }, smallButtonText: { color: colors.accent, fontWeight: '700' },
    saveRow: { flexDirection: 'row', gap: 10, marginTop: 8 }, primary: { flex: 1, minHeight: 48, borderRadius: 12, backgroundColor: colors.accent, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 12 }, primaryText: { color: colors.accentInk, fontWeight: '800', textAlign: 'center' }, secondary: { flex: 1, minHeight: 48, borderRadius: 12, borderWidth: 1, borderColor: colors.borderStrong, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 12 }, secondaryText: { color: colors.accent, fontWeight: '700', textAlign: 'center' },
});
