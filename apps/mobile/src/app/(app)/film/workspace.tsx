import { rawText } from '../../../lib/i18n/translate';
import { Text as StatusText } from '../../../components/ui/Text';
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
import { Stack, useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useAuth } from '../../../auth/AuthProvider';
import { accessibleStage, emptyFilm, FILM_STAGES, stageIssues, type Film } from '../../../lib/filmStudio';
import { clearOpenedFilm, getActiveCloudLink, getFilmGeneration, loadActiveStudio } from '../../../lib/filmCloud';
import { FilmCloudBar } from '../../../components/film/FilmCloudBar';
import { FilmPassportsStage } from '../../../components/film/FilmPassportsStage';
import { FilmTestsStage } from '../../../components/film/FilmTestsStage';
import { FilmPromptsStage } from '../../../components/film/FilmPromptsStage';
import { clearStudio } from '../../../lib/filmStudioStore';
import { colors, fonts } from '../../../theme';


export default function FilmWorkspace() {
    const { api } = useAuth();
    const router = useRouter();
    const [film, setFilm] = useState<Film | null>(null);
    const [cloudLink, setCloudLink] = useState(getActiveCloudLink);
    const [stage, setStage] = useState(0);
    const latestFilm = useRef<Film | null>(null);
    const [binding, setBinding] = useState<{ owner: string | undefined; generation: number } | null>(null);
    const generation = useRef(0);
    const installing = useRef(false);
    const cloudGeneration = useRef(getFilmGeneration());
    const [catalog, setCatalog] = useState<CatalogModel[]>([]);
    const [live, setLive] = useState(false);
    const [unavailable, setUnavailable] = useState(false);
    const [catalogTry, setCatalogTry] = useState(0);
    const autosave = useFilmAutosave();
    const { cancel, flush, schedule } = autosave;
    const valid = () => !installing.current && cloudGeneration.current === getFilmGeneration() && binding !== null && binding.owner === getCacheUser() && binding.generation === generation.current;

    const installFilm = useCallback((next: Film, owner: string | undefined) => {
        cancel(); cloudGeneration.current = getFilmGeneration(); const session = ++generation.current; installing.current = false;
        setBinding({ owner, generation: session }); latestFilm.current = next; setFilm(next);
        setCloudLink(getActiveCloudLink());
        setStage(current => Math.min(current, accessibleStage(next)));
    }, [cancel]);

    useFocusEffect(useCallback(() => {
        let active = true;
        if (cloudGeneration.current !== getFilmGeneration()) {
            const owner = getCacheUser(), session = generation.current;
            installing.current = true; cancel();
            void loadActiveStudio().then(saved => {
                if (active && owner === getCacheUser() && session === generation.current) installFilm(saved?.film ?? emptyFilm(), owner);
            });
        }
        return () => { active = false; void flush().catch(() => undefined); };
    }, [flush, cancel, installFilm]));
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
                installFilm(next, owner);
            };
            loadActiveStudio().then(saved => apply(saved?.film ?? emptyFilm()), () => apply(emptyFilm()));
        };
        const unsubscribe = subscribeCacheUser(() => {
            generation.current++; cancel(); latestFilm.current = null; setBinding(null); setFilm(null); setCloudLink(null); installing.current = false; load();
        });
        load();
        return () => { unsubscribe(); generation.current++; };
    }, [cancel, installFilm]);
    useEffect(() => {
        let active = true;
        setUnavailable(false);
        const apply = (models: CatalogModel[]) => { if (active) { setCatalog(models); setLive(true); } };
        fetchCatalogCached(apply).then(result => apply(result.value), () => { if (active) setUnavailable(true); });
        return () => { active = false; };
    }, [catalogTry]);

    const change = (next: Film) => {
        if (!valid()) return;
        latestFilm.current = next; setFilm(next); schedule(next, valid);
    };
    function newFilm() {
        if (!valid() || !binding) return;
        const owner = binding.owner, session = binding.generation;
        const current = () => owner === getCacheUser() && session === generation.current;
        Alert.alert(t('film.startanewfilm2'), t('film.thestudiocurrentlyopenonthisphone'), [
            { text: t('film.cancel'), style: 'cancel' },
            { text: t('film.startnew'), style: 'destructive', onPress: async () => {
                if (!current()) return;
                installing.current = true; cancel(); clearOpenedFilm(); latestFilm.current = null; setFilm(null); setBinding(null);
                const nextGeneration = ++generation.current;
                await clearStudio(appCache, owner);
                if (owner !== getCacheUser() || nextGeneration !== generation.current) return;
                const next = emptyFilm();
                installFilm(next, owner); setStage(0);
                const installed = generation.current;
                schedule(next, () => owner === getCacheUser() && installed === generation.current);
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
                    return <Pressable key={title} accessibilityRole="tab" accessibilityLabel={rawText(title)} disabled={index > available} accessibilityState={{ selected: stage === index, disabled: index > available }} style={[styles.stageChip, stage === index && styles.stageChipOn, index > available && styles.stageChipDisabled]} onPress={() => setStage(index)}>
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
                {stage === 0 ? <FilmSetupStage key={generation.current} film={film} change={change} catalog={catalog} live={live} unavailable={unavailable} retry={() => setCatalogTry(n => n + 1)} /> : null}
                {stage === 1 ? <Identity key={generation.current} film={film} change={change} catalog={catalog} live={live} /> : null}
                {stage === 2 ? <FilmBreakdownStage key={generation.current} film={film} change={change} catalog={catalog} live={live} /> : null}
                {stage === 3 ? <FilmBoardsStage key={generation.current} film={film} change={change} catalog={catalog} live={live} /> : null}
                {stage === 4 ? <FilmPassportsStage key={generation.current} film={film} change={change} catalog={catalog} live={live} /> : null}
                {stage === 5 ? <FilmTestsStage key={generation.current} film={film} change={change} catalog={catalog} live={live} /> : null}
                {stage === 6 ? <FilmPromptsStage key={generation.current} film={film} change={change} catalog={catalog} live={live} /> : null}
                {stage < 6 ? <Button label={t('filmWorkspace.continue', { value1: FILM_STAGES[stage + 1][1] })} disabled={issues.length > 0} onPress={() => setStage(stage + 1)} /> : null}
                <StatusText variant="inherit" accessibilityLiveRegion="polite" style={styles.help}>{autosave.status === 'saving' ? t('film.saving') : autosave.status === 'failed' ? t('filmWorkspace.notSaved', { reason: autosave.reason }) : cloudLink ? t('filmWorkspace.memorySaved') : t('filmWorkspace.saved')}</StatusText>
                <FilmCloudBar key={`cloud-${generation.current}`} api={api} film={film} flush={flush} snapshot={() => latestFilm.current ?? film} valid={valid}
                    onSaved={() => setCloudLink(getActiveCloudLink())}
                    beginInstall={() => { installing.current = true; cancel(); }} endInstall={() => { cloudGeneration.current = getFilmGeneration(); installing.current = false; }} installFilm={installFilm} />
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

type Props = { film: Film; change: (film: Film) => void; catalog: readonly CatalogModel[]; live: boolean };
const styles = StyleSheet.create({
    stageChipDisabled: { opacity: 0.45 },
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
