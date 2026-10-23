import { randomUUID } from 'expo-crypto';
import { Stack, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useAuth } from '../../../auth/AuthProvider';
import { ApiError } from '../../../lib/api';
import { ACCEPTANCE_CHECKS, assetKey, assetType, buildShotPrompt, emptyFilm, FILM_STAGES, isLocked, latestPrompt, lockAsset, logFilmAttempt, nextPromptVersion, PROMPT_DETAILS, SHOT_LANES, shotAssets, stageIssues, STYLE_BOARDS, testMatrix, type Asset, type Board, type Film, type Shot } from '../../../lib/filmStudio';
import { clearOpenedFilm, cloudStatus, loadActiveStudio, replaceActiveStudio, saveActiveStudioToCloud } from '../../../lib/filmCloud';
import { clearStudio } from '../../../lib/filmStudioStore';
import { colors, fonts } from '../../../theme';

const blankShot = (id: string): Shot => ({
    id, location: '', time: '', characters: 'none', props: 'none', description: '', dialogue: 'none', seconds: '10', complexity: 'low',
    goal: '', action: '', dramaturgy: '', blocking: '', acting: '', style: '', size: '', movement: '', lens: '', angle: '', cut: '', pace: '', transition: '', oneAction: false,
});
const referenceLines = (board: Board): string => board.references.map((reference) => `${reference.kind === 'anti-reference' ? '!' : ''}${reference.source} | ${reference.caption}`).join('\n');
const parseReferences = (text: string): Board['references'] => text.split('\n').map((line) => line.trim()).filter(Boolean).map((line) => {
    const anti = line.startsWith('!');
    const [source, ...caption] = (anti ? line.slice(1) : line).split('|');
    return { source: source.trim(), caption: caption.join('|').trim(), kind: anti ? 'anti-reference' : 'reference' };
});
const requiredAssets = (film: Film): string[] => [...new Set(film.shots.flatMap(shotAssets))];

export default function FilmWorkspace() {
    const { api } = useAuth();
    const router = useRouter();
    const [film, setFilm] = useState<Film | null>(null);
    const [stage, setStage] = useState(0);
    const [dirty, setDirty] = useState(false);
    const [busy, setBusy] = useState(false);
    const [note, setNote] = useState<string | null>(null);

    useEffect(() => {
        let live = true;
        loadActiveStudio().then((saved) => { if (live) setFilm(saved?.film ?? emptyFilm()); }, () => { if (live) setFilm(emptyFilm()); });
        return () => { live = false; };
    }, []);

    const change = (next: Film) => { setFilm(next); setDirty(true); setNote(null); };
    async function save(cloud: boolean) {
        if (!film || busy) return;
        setBusy(true); setNote(null);
        try {
            await replaceActiveStudio(film);
            setDirty(false);
            if (cloud) {
                try {
                    const project = await saveActiveStudioToCloud(api, film, randomUUID());
                    setNote(`Saved to your account · revision ${project.revision}`);
                } catch (error) {
                    const status = cloudStatus(error);
                    const message = error instanceof ApiError && error.status === 409
                        ? 'This film changed elsewhere. Your edit is saved on this phone; open the latest account copy before saving again.'
                        : status === 'offline'
                            ? 'You’re offline. Your film is saved on this phone; save to your account when you’re connected.'
                            : status === 'busy'
                                ? 'Account saving is busy. Your film is saved on this phone; try again in a moment.'
                                : status === 'unavailable'
                                    ? 'Account saving is not available right now. Your film is saved on this phone.'
                                    : 'Your film is saved on this phone, but could not be saved to your account.';
                    setNote(message);
                }
            } else setNote('Saved on this phone.');
        } catch (error) {
            setNote(error instanceof Error && error.message ? error.message : 'Could not save the studio.');
        } finally { setBusy(false); }
    }

    function newFilm() {
        Alert.alert('Start a new film?', 'The studio currently open on this phone will be replaced. Save it to your account first if you want to keep it.', [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Start new', style: 'destructive', onPress: async () => { clearOpenedFilm(); await clearStudio(); setFilm(emptyFilm()); setStage(0); setDirty(true); setNote(null); } },
        ]);
    }

    if (!film) return <ActivityIndicator style={{ flex: 1 }} color={colors.accent} />;
    const issues = stageIssues(film, stage);
    return (
        <View style={styles.screen}>
            <Stack.Screen options={{ title: film.name || 'Film Studio workspace' }} />
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.stageBar} contentContainerStyle={styles.stageBarContent}>
                {FILM_STAGES.map(([, title], index) => {
                    const open = stageIssues(film, index).length;
                    return <Pressable key={title} accessibilityRole="tab" accessibilityState={{ selected: stage === index }} style={[styles.stageChip, stage === index && styles.stageChipOn]} onPress={() => setStage(index)}>
                        <Text style={[styles.stageChipText, stage === index && styles.stageChipTextOn]}>{index + 1}. {title}{open ? ` · ${open}` : ' · ✓'}</Text>
                    </Pressable>;
                })}
            </ScrollView>
            <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}>
                <View style={styles.titleRow}>
                    <View style={{ flex: 1 }}><Text style={styles.kicker}>STAGE {stage + 1} OF 7</Text><Text style={styles.title} accessibilityRole="header">{FILM_STAGES[stage][1]}</Text></View>
                    <Pressable accessibilityRole="button" style={styles.smallButton} onPress={newFilm}><Text style={styles.smallButtonText}>New</Text></Pressable>
                </View>
                {issues.length ? <View style={styles.issues}><Text style={styles.issueTitle}>{issues.length} item{issues.length === 1 ? '' : 's'} to finish</Text>{issues.slice(0, 4).map((issue) => <Text key={issue} style={styles.issue}>• {issue}</Text>)}</View> : <Text style={styles.complete}>✓ This stage is complete</Text>}
                {stage === 0 ? <Setup film={film} change={change} /> : null}
                {stage === 1 ? <Identity film={film} change={change} /> : null}
                {stage === 2 ? <Breakdown film={film} change={change} /> : null}
                {stage === 3 ? <Boards film={film} change={change} /> : null}
                {stage === 4 ? <Passports film={film} change={change} /> : null}
                {stage === 5 ? <Tests film={film} change={change} /> : null}
                {stage === 6 ? <Prompts film={film} change={change} router={router} /> : null}
                {note ? <Text accessibilityLiveRegion="polite" style={note.startsWith('Could') || note.includes('missing') ? styles.error : styles.complete}>{note}</Text> : null}
                <View style={styles.saveRow}>
                    <Pressable accessibilityRole="button" accessibilityState={{ disabled: busy }} disabled={busy} style={styles.secondary} onPress={() => void save(false)}><Text style={styles.secondaryText}>{busy ? 'Saving…' : dirty ? 'Save on phone' : 'Saved on phone'}</Text></Pressable>
                    <Pressable accessibilityRole="button" accessibilityState={{ disabled: busy }} disabled={busy} style={styles.primary} onPress={() => void save(true)}><Text style={styles.primaryText}>Save to account</Text></Pressable>
                </View>
            </ScrollView>
        </View>
    );
}

function Setup({ film, change }: Props) {
    const stack = (key: keyof Film['stack'], value: string) => change({ ...film, stack: { ...film.stack, [key]: value } });
    return <View style={styles.section}>
        <Field label="Image model" value={film.stack.image} onChange={(value) => stack('image', value)} placeholder="Model name or id" />
        <Field label="How you access it" value={film.stack.imageAccess} onChange={(value) => stack('imageAccess', value)} placeholder="Studio or external service" />
        <Field label="Video model" value={film.stack.video} onChange={(value) => stack('video', value)} placeholder="Model name or id" />
        <Field label="How you access it" value={film.stack.videoAccess} onChange={(value) => stack('videoAccess', value)} placeholder="Studio or external service" />
        <Text style={styles.label}>Clip length</Text><Choices values={['10', '12', '15']} selected={film.stack.seconds} onPick={(value) => stack('seconds', value)} suffix=" sec" />
    </View>;
}

function Identity({ film, change }: Props) {
    return <View style={styles.section}>
        <Field label="Studio name" value={film.name} onChange={(name) => change({ ...film, name })} maxLength={120} placeholder="Untitled film" />
        <Text style={styles.label}>Final runtime</Text><Choices values={['30', '60', '90', '120']} selected={String(film.targetSeconds)} onPick={(value) => change({ ...film, targetSeconds: Number(value) })} suffix=" sec" />
        <Text style={styles.label}>Aspect ratio</Text><Choices values={['16:9', '9:16', '1:1']} selected={film.stack.aspect} onPick={(value) => change({ ...film, stack: { ...film.stack, aspect: value } })} />
    </View>;
}

function Breakdown({ film, change }: Props) {
    const setShot = (index: number, shot: Shot) => change({ ...film, shots: film.shots.map((item, i) => i === index ? shot : item) });
    return <View style={styles.section}>
        <Field label="Script, treatment or idea" value={film.script} onChange={(script) => change({ ...film, script })} multiline maxLength={24_000} placeholder="Paste the source material you are breaking down." />
        {film.shots.map((shot, index) => <View key={`${index}-${shot.id}`} style={styles.card}>
            <View style={styles.titleRow}><Text style={styles.cardTitle}>Shot {index + 1}</Text><Pressable accessibilityRole="button" onPress={() => change({ ...film, shots: film.shots.filter((_, i) => i !== index) })}><Text style={styles.remove}>Remove</Text></Pressable></View>
            {SHOT_LANES.map(([lane, fields]) => <View key={lane} style={styles.fieldGroup}><Text style={styles.groupTitle}>{lane}</Text>{fields.map(([key, label]) => <Field key={key} label={label} value={String(shot[key] ?? '')} onChange={(value) => setShot(index, { ...shot, [key]: value })} />)}</View>)}
            <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: shot.oneAction }} style={[styles.choice, shot.oneAction && styles.choiceOn]} onPress={() => setShot(index, { ...shot, oneAction: !shot.oneAction })}><Text style={styles.choiceText}>{shot.oneAction ? '✓ ' : ''}One action in this clip</Text></Pressable>
        </View>)}
        <Pressable accessibilityRole="button" style={styles.secondary} onPress={() => change({ ...film, shots: [...film.shots, blankShot(`S${film.shots.length + 1}`)] })}><Text style={styles.secondaryText}>Add shot</Text></Pressable>
    </View>;
}

function Boards({ film, change }: Props) {
    const required = [...requiredAssets(film).map((name) => ({ name, type: assetType(film, name) })), ...STYLE_BOARDS.map((name) => ({ name, type: 'style' }))];
    const addMissing = () => change({ ...film, boards: [...film.boards, ...required.filter((need) => !film.boards.some((board) => board.name === need.name && board.type === need.type)).map((need, index) => ({ id: `board-${Date.now()}-${index}`, name: need.name, type: need.type, decision: '', references: [] }))] });
    return <View style={styles.section}>
        <Text style={styles.help}>One line per reference: source | precise caption. Prefix a source with ! to mark an anti-reference.</Text>
        <Pressable accessibilityRole="button" style={styles.secondary} onPress={addMissing}><Text style={styles.secondaryText}>Create missing boards</Text></Pressable>
        {film.boards.map((board, index) => <View key={board.id} style={styles.card}>
            <Text style={styles.cardTitle}>{board.name} · {board.type}</Text>
            <Field label="References" value={referenceLines(board)} multiline placeholder="file-or-url | what must remain consistent" onChange={(value) => change({ ...film, boards: film.boards.map((item, i) => i === index ? { ...item, references: parseReferences(value) } : item) })} />
            <Choices values={['draft', 'approved', 'revise', 'rejected']} selected={board.decision || 'draft'} onPick={(decision) => change({ ...film, boards: film.boards.map((item, i) => i === index ? { ...item, decision: decision === 'draft' ? '' : decision } : item) })} />
        </View>)}
    </View>;
}

function Passports({ film, change }: Props) {
    const required = requiredAssets(film);
    const addMissing = () => change({ ...film, assets: [...film.assets, ...required.filter((key) => !film.assets.some((asset) => assetKey(asset) === key)).map((key) => { const [tag, version] = key.split(':v'); return { tag, version: Number(version), type: assetType(film, key), descriptor: '', references: [], tests: {} }; })] });
    return <View style={styles.section}>
        <Pressable accessibilityRole="button" style={styles.secondary} onPress={addMissing}><Text style={styles.secondaryText}>Create missing passports</Text></Pressable>
        {film.assets.map((asset, index) => <View key={assetKey(asset)} style={styles.card}>
            <Text style={styles.cardTitle}>{assetKey(asset)} · {asset.type}{isLocked(film, asset) ? ' · LOCKED' : ''}</Text>
            <Field label="Canonical descriptor" value={asset.descriptor} multiline onChange={(descriptor) => updateAsset(film, change, index, { ...asset, descriptor })} placeholder="Exact identity, form, material, colour, wear and distinguishing details." />
            <Field label="Approved reference files" value={asset.references.join('\n')} multiline onChange={(value) => updateAsset(film, change, index, { ...asset, references: value.split('\n').map((line) => line.trim()).filter(Boolean) })} placeholder="One file or Library reference per line" />
        </View>)}
    </View>;
}

function Tests({ film, change }: Props) {
    const lock = (key: string) => { try { change(lockAsset(film, key)); } catch (error) { Alert.alert('Cannot lock this asset', error instanceof Error ? error.message : 'Finish every test first.'); } };
    return <View style={styles.section}>{film.assets.map((asset, index) => <View key={assetKey(asset)} style={styles.card}>
        <Text style={styles.cardTitle}>{assetKey(asset)} {isLocked(film, asset) ? '· LOCKED' : '· DRAFT'}</Text>
        {testMatrix(film, asset).map((row) => { const test = asset.tests[row.id] ?? { result: '', verdict: 'pending' }; return <View key={row.id} style={styles.testRow}>
            <Text style={styles.groupTitle}>{row.id} · {row.angle} · {row.size}{row.pair ? ` · with ${row.pair}` : ''}</Text>
            <Field label="Actual output reference" value={test.result} onChange={(result) => updateAsset(film, change, index, { ...asset, tests: { ...asset.tests, [row.id]: { ...test, result } } })} />
            <Choices values={['pending', 'pass', 'miss']} selected={test.verdict} onPick={(verdict) => updateAsset(film, change, index, { ...asset, tests: { ...asset.tests, [row.id]: { ...test, verdict } } })} />
        </View>; })}
        <Pressable accessibilityRole="button" style={styles.primary} onPress={() => lock(assetKey(asset))}><Text style={styles.primaryText}>{isLocked(film, asset) ? 'Locked' : 'Lock after every test passes'}</Text></Pressable>
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
        catch (error) { Alert.alert('Prompt not ready', error instanceof Error ? error.message : 'Finish the earlier stages first.'); }
    };
    const log = () => {
        const prompt = shot ? latestPrompt(film, shot.id) : null;
        if (!prompt) return;
        try {
            change(logFilmAttempt(film, prompt, { result, changed, verdict, checks }));
            setResult(''); setChanged(''); setVerdict('rejected'); setChecks([]);
        } catch (error) { Alert.alert('Result not recorded', error instanceof Error ? error.message : 'Check every field and try again.'); }
    };
    return <View style={styles.section}>
        {film.shots.length ? <Choices values={film.shots.map((item) => item.id)} selected={shot?.id ?? ''} onPick={setSelected} /> : <Text style={styles.help}>Add a shot in stage 3 first.</Text>}
        {shot ? <>
            {PROMPT_DETAILS.map(([key, label]) => <Field key={key} label={label} value={details[key] ?? ''} multiline={key === 'constraints' || key === 'quality'} onChange={(value) => setDetails((current) => ({ ...current, [key]: value }))} />)}
            <Pressable accessibilityRole="button" style={styles.primary} onPress={build}><Text style={styles.primaryText}>{latestPrompt(film, shot.id) ? 'Create next prompt version' : 'Build 15-block prompt'}</Text></Pressable>
            {latestPrompt(film, shot.id) ? <View style={styles.card}>
                <Text style={styles.cardTitle}>Prompt v{latestPrompt(film, shot.id)?.version}</Text><Text selectable style={styles.prompt}>{latestPrompt(film, shot.id)?.content}</Text>
                <Pressable accessibilityRole="button" style={styles.secondary} onPress={() => router.push({ pathname: '/film/shot/[id]', params: { id: shot.id } })}><Text style={styles.secondaryText}>Open shot and send to Create</Text></Pressable>
                <Text style={styles.groupTitle}>LOG THE GENERATED TAKE</Text>
                <Field label="Result file or Library reference" value={result} onChange={setResult} />
                <Field label="What changed for this version" value={changed} onChange={setChanged} multiline />
                <Choices values={['rejected', 'accepted']} selected={verdict} onPick={(value) => setVerdict(value as 'accepted' | 'rejected')} />
                {verdict === 'accepted' ? <View style={styles.section}>{ACCEPTANCE_CHECKS.map((check) => <Pressable key={check} accessibilityRole="checkbox" accessibilityState={{ checked: checks.includes(check) }} style={[styles.choice, checks.includes(check) && styles.choiceOn]} onPress={() => setChecks((current) => current.includes(check) ? current.filter((item) => item !== check) : [...current, check])}><Text style={styles.choiceText}>{checks.includes(check) ? '✓ ' : ''}{check}</Text></Pressable>)}</View> : null}
                <Pressable accessibilityRole="button" style={styles.primary} onPress={log}><Text style={styles.primaryText}>Record {verdict} take</Text></Pressable>
            </View> : null}
        </> : null}
    </View>;
}

type Props = { film: Film; change: (film: Film) => void };
function updateAsset(film: Film, change: Props['change'], index: number, asset: Asset) { change({ ...film, assets: film.assets.map((item, i) => i === index ? asset : item) }); }
function Field({ label, value, onChange, placeholder, multiline = false, maxLength = 2_000 }: { label: string; value: string; onChange: (value: string) => void; placeholder?: string; multiline?: boolean; maxLength?: number }) {
    return <View style={styles.field}><Text style={styles.label}>{label}</Text><TextInput accessibilityLabel={label} style={[styles.input, multiline && styles.multiline]} value={value} onChangeText={onChange} placeholder={placeholder} placeholderTextColor={colors.muted} multiline={multiline} maxLength={maxLength} /></View>;
}
function Choices({ values, selected, onPick, suffix = '' }: { values: readonly string[]; selected: string; onPick: (value: string) => void; suffix?: string }) {
    return <View style={styles.choices}>{values.map((value) => <Pressable key={value} accessibilityRole="radio" accessibilityState={{ selected: value === selected }} style={[styles.choice, value === selected && styles.choiceOn]} onPress={() => onPick(value)}><Text style={[styles.choiceText, value === selected && styles.choiceTextOn]}>{value}{suffix}</Text></Pressable>)}</View>;
}

const styles = StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.background }, stageBar: { flexGrow: 0, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border }, stageBarContent: { paddingHorizontal: 12, paddingVertical: 10, gap: 8 },
    stageChip: { minHeight: 40, justifyContent: 'center', borderRadius: 20, paddingHorizontal: 14, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border }, stageChipOn: { backgroundColor: colors.accent, borderColor: colors.accent }, stageChipText: { color: colors.body, fontSize: 13, fontWeight: '700' }, stageChipTextOn: { color: colors.accentInk },
    content: { padding: 16, paddingBottom: 100, gap: 16 }, titleRow: { flexDirection: 'row', alignItems: 'center', gap: 12 }, kicker: { color: colors.accent, fontSize: 11, fontWeight: '900', letterSpacing: 1.4 }, title: { color: colors.text, fontFamily: fonts.display, fontSize: 26 },
    issues: { gap: 5, borderRadius: 14, borderWidth: 1, borderColor: colors.money, backgroundColor: colors.surface, padding: 14 }, issueTitle: { color: colors.money, fontWeight: '800' }, issue: { color: colors.body, fontSize: 13, lineHeight: 18 }, complete: { color: colors.accent, fontWeight: '700' }, error: { color: colors.danger },
    section: { gap: 14 }, card: { gap: 12, borderRadius: 16, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, padding: 14 }, cardTitle: { color: colors.text, fontSize: 17, fontWeight: '800' }, groupTitle: { color: colors.accent, fontSize: 13, fontWeight: '800' }, fieldGroup: { gap: 10, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border, paddingTop: 12 },
    field: { gap: 6 }, label: { color: colors.body, fontSize: 13, fontWeight: '700' }, input: { minHeight: 46, borderRadius: 12, borderWidth: 1, borderColor: colors.borderStrong, backgroundColor: colors.background, color: colors.text, paddingHorizontal: 12, paddingVertical: 10, fontSize: 16 }, multiline: { minHeight: 110, textAlignVertical: 'top' }, help: { color: colors.muted, fontSize: 13, lineHeight: 19 },
    choices: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 }, choice: { minHeight: 44, justifyContent: 'center', borderRadius: 12, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, paddingHorizontal: 14 }, choiceOn: { borderColor: colors.accent, backgroundColor: colors.accentSoft }, choiceText: { color: colors.body, fontWeight: '600' }, choiceTextOn: { color: colors.accent, fontWeight: '800' },
    testRow: { gap: 8, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border, paddingTop: 12 }, prompt: { color: colors.body, fontSize: 12, lineHeight: 18 }, remove: { color: colors.danger, fontWeight: '700' }, smallButton: { minWidth: 50, minHeight: 44, justifyContent: 'center', alignItems: 'center' }, smallButtonText: { color: colors.accent, fontWeight: '700' },
    saveRow: { flexDirection: 'row', gap: 10, marginTop: 8 }, primary: { flex: 1, minHeight: 48, borderRadius: 12, backgroundColor: colors.accent, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 12 }, primaryText: { color: colors.accentInk, fontWeight: '800', textAlign: 'center' }, secondary: { flex: 1, minHeight: 48, borderRadius: 12, borderWidth: 1, borderColor: colors.borderStrong, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 12 }, secondaryText: { color: colors.accent, fontWeight: '700', textAlign: 'center' },
});
