jest.mock('../src/auth/AuthProvider', () => { const api = { request: jest.fn() }; return { useAuth: () => ({ api }) }; });
import { act } from 'react';
import * as RN from 'react-native';
import { createRoot, type Root } from 'test-renderer';
import { FilmPassportsStage } from '../src/components/film/FilmPassportsStage';
import { FilmTestsStage } from '../src/components/film/FilmTestsStage';
import { FilmPromptsStage } from '../src/components/film/FilmPromptsStage';
import { assetKey, buildShotPrompt, emptyFilm, lockAsset, nextPromptVersion, PROMPT_DETAILS, promptContext, SHOT_LANES, STYLE_BOARDS, testMatrix, testPrompt, type Film } from '../src/lib/filmStudio';
import { newShot } from '../src/lib/filmStudioOptions';
import { t } from '../src/lib/i18n';
const mockRouter = { push: jest.fn() };
jest.mock('expo-router', () => ({ useRouter: () => mockRouter }));
jest.mock('../src/lib/clipboard', () => ({ copyText: jest.fn().mockResolvedValue(true) }));
void [RN.View, RN.Text, RN.TextInput, RN.Pressable, RN.Modal, RN.FlatList, RN.StyleSheet];
let root: Root, film: Film, Component: typeof FilmPassportsStage;
const textOf = (n: any): string => n.children.map((c: any) => typeof c === 'string' ? c : textOf(c)).join('');
const field = (label: string) => root.container.queryAll(n => n.props.accessibilityLabel === label && n.props.onChangeText)[0];
const button = (label: string) => root.container.queryAll(n => n.props.accessibilityRole === 'button' && n.props.accessibilityLabel === label)[0];
const click = async (n: any) => act(async () => n.props.onClick({ nativeEvent: {}, currentTarget: 1, target: 1 }));
const type = async (label: string, value: string) => act(async () => field(label).props.onChangeText(value));
const render = () => root.render(<Component film={film} change={next => { film = next; render(); }} catalog={[]} live={false} />);
function fixture(): Film {
    const f = emptyFilm(); f.name = 'Film'; f.script = 'Script'; f.stack.image = 'image'; f.stack.video = 'video'; f.targetSeconds = 30;
    const shot = newShot(f); for (const [, fields] of SHOT_LANES) for (const [key] of fields) if (!shot[key]) shot[key] = 'value';
    Object.assign(shot, { location: '@room:v1', characters: 'none', props: 'none', dialogue: 'none', oneAction: true, seconds: '10' }); f.shots = [shot];
    const board = (name: string, kind: string, n: number) => ({ id: name, name, type: kind, decision: 'approved', references: Array.from({ length: n }, (_, i) => ({ source: `ref-${i}`, caption: 'specific caption', kind: 'reference' })) });
    f.boards = [board('@room:v1', 'location', 8), ...STYLE_BOARDS.map(n => board(n, 'style', 1))];
    f.assets = [{ tag: '@room', version: 1, type: 'location', descriptor: 'A blue room', references: ['room.png'], tests: {} }]; return f;
}
function locked(): Film {
    const f = fixture(); f.assets[0].tests = Object.fromEntries(testMatrix(f, f.assets[0]).map(r => [r.id, { result: `output-${r.id}.png`, verdict: 'pass' }]));
    return lockAsset(f, assetKey(f.assets[0]));
}
function prompted(logged = false): Film {
    const f = locked(); const shot = f.shots[0]; const details = Object.fromEntries(PROMPT_DETAILS.map(([key]) => [key, 'detail']));
    f.prompts = [nextPromptVersion(f, shot, buildShotPrompt(f, shot, details))];
    if (logged) f.attempts = [{ shot: shot.id, version: 1, result: 'take.mp4', changed: 'First', verdict: 'rejected', at: 'now' }];
    return f;
}
beforeEach(() => { (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true; root = createRoot(); film = fixture(); });
afterEach(async () => act(async () => root.unmount()));
test('passport prefill, required values and save without any lock property', async () => {
    Component = FilmPassportsStage; film.assets = []; await act(async () => render());
    expect(field(t('film.approvedreferencefiles')).props.value).toBe(film.boards[0].references.map(r => r.source).join('\n'));
    expect(button(t('filmOutput.savePassport')).props.accessibilityState.disabled).toBe(true);
    await type(t('film.canonicaldescriptor'), 'Canonical room'); await click(button(t('filmOutput.savePassport')));
    expect(film.assets[0]).toMatchObject({ descriptor: 'Canonical room', tests: {} }); expect(film.assets[0]).not.toHaveProperty('lock');
    await type(t('film.approvedreferencefiles'), ''); expect(button(t('filmOutput.savePassport')).props.accessibilityState.disabled).toBe(true);
});
test('locked passport fields and Save are disabled', async () => {
    Component = FilmPassportsStage; film = locked(); await act(async () => render());
    expect(field(t('film.canonicaldescriptor')).props.editable).toBe(false); expect(field(t('film.approvedreferencefiles')).props.editable).toBe(false);
    expect(button(t('filmOutput.savePassport')).props.accessibilityState.disabled).toBe(true);
});
test('tests begin expanded, render exact prompt, clear stale lock on edits, require every pass', async () => {
    Component = FilmTestsStage; film.assets[0].lock = { context: 'old', at: 'now' }; await act(async () => render());
    const row = testMatrix(film, film.assets[0])[0];
    expect(textOf(root.container)).toContain(testPrompt(film, film.assets[0], row));
    expect(root.container.queryAll(n => n.props.accessibilityState?.expanded === true)).toHaveLength(1);
    expect(button(t('film.lockaftereverytestpasses')).props.accessibilityState.disabled).toBe(true);
    await type(t('film.actualoutputreference'), 'result'); expect(film.assets[0]).not.toHaveProperty('lock');
    film = locked(); await act(async () => render()); expect(field(t('film.actualoutputreference')).props.editable).toBe(false);
});
test('current prompts hide detail fields; logged prompts hide Record and revision creates v2', async () => {
    Component = FilmPromptsStage; film = prompted(); await act(async () => render());
    expect(field(PROMPT_DETAILS[0][1])).toBeUndefined(); expect(button(t('filmOutput.record'))).toBeDefined();
    expect(field(t('film.whatchangedforthisversion')).props.value).toBe(t('filmOutput.first'));
    film = prompted(true); await act(async () => render()); expect(button(t('filmOutput.record'))).toBeUndefined();
    const content = film.prompts[0].content.replace('detail', 'revised detail');
    await type(t('filmOutput.revise'), content); await click(button(t('filmOutput.saveRevision')));
    expect(film.prompts.at(-1)?.version).toBe(2); expect(field(t('film.whatchangedforthisversion')).props.value).toBe(t('filmOutput.revised'));
});
test('15 misses stop revisions and display the attempt result', async () => {
    Component = FilmPromptsStage; film = prompted(true);
    film.prompts = Array.from({ length: 15 }, (_, i) => ({ ...film.prompts[0], version: i + 1 }));
    film.attempts = film.prompts.map(p => ({ shot: p.shot, version: p.version, verdict: 'rejected', changed: 'line', result: `take-${p.version}`, at: 'now' }));
    await act(async () => render()); expect(textOf(root.container)).toContain(t('filmWorkspace.fifteenMisses'));
    expect(button(t('filmOutput.saveRevision'))).toBeUndefined(); expect(textOf(root.container)).toContain('take-15');
});
test('stale unlogged v1 displays details and rebuild creates v2', async () => {
    Component = FilmPromptsStage; film = prompted(); film.shots[0] = { ...film.shots[0], goal: 'new goal' }; await act(async () => render());
    expect(textOf(root.container)).toContain(t('filmOutput.stale')); expect(button(t('filmOutput.record'))).toBeUndefined();
    for (const [, label] of PROMPT_DETAILS) await type(label, 'fresh direction');
    await click(button(t('film.build15blockprompt'))); expect(film.prompts.at(-1)?.version).toBe(2);
    expect(film.prompts.at(-1)?.context).toBe(promptContext(film, film.shots[0]));
});
