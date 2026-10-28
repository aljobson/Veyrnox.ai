import { act } from 'react';
import * as RN from 'react-native';
import { createRoot, type Root } from 'test-renderer';
import StudioSkills from '../src/app/(app)/chat/skills';
import { AppearanceContext } from '../src/components/ui/AppearanceContext';
import { DEFAULT_APPEARANCE } from '../src/theme';
import { API_BASE } from '../src/lib/api';
import { skillIcon } from '../src/lib/featureIcons';
import { plural, t } from '../src/lib/i18n';
import { parseOddlingInstructions } from '../src/lib/oddlingsChat';
import { MAX_SELECTED_SKILLS, SKILLS, SKILL_GROUPS, SKILL_MODEL, selectedSkillIds, skillById, skillsInstructions } from '../src/lib/studioSkills';
import { workflowById, workflowSteps } from '../src/lib/studioWorkflows';
const mockRouter = { push: jest.fn(), replace: jest.fn() }, mockApi = {};
const mockChat = { listModels: jest.fn(), createThread: jest.fn(), updateThread: jest.fn(), deleteThread: jest.fn() };
const mockCatalog = jest.fn(), mockCopy = jest.fn();
let mockParams: any = {}, mockReduced = false;
let mockDimensions = { width: 402, height: 874, scale: 3, fontScale: 1 };
jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({ default: () => mockDimensions }));
jest.mock('../src/components/ui/Icon', () => ({ Icon: ({ name }: { name: string }) => jest.requireActual('react').createElement(jest.requireActual('react-native').View, { testID: `icon:${name}` }) }));
jest.mock('expo-router', () => ({ Stack: { Screen: () => null }, useRouter: () => mockRouter, useLocalSearchParams: () => mockParams }));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ bottom: 20 }) }));
jest.mock('../src/auth/AuthProvider', () => ({ useAuth: () => ({ api: mockApi }) }));
jest.mock('../src/lib/chat', () => ({ ...jest.requireActual('../src/lib/chat'), chatApi: () => mockChat }));
jest.mock('../src/lib/media', () => ({ ...jest.requireActual('../src/lib/media'), fetchCatalog: () => mockCatalog() }));
jest.mock('../src/lib/clipboard', () => ({ copyText: (...args: any[]) => mockCopy(...args) }));
jest.mock('../src/components/ui/useReducedMotion', () => ({ useReducedMotion: () => mockReduced }));
void [RN.View, RN.Text, RN.Pressable, RN.ScrollView, RN.Modal];
let root: Root;
const catalog = [{ id: 'image', name: 'Image', modality: 'text-to-image', credits: 7, gated: false, durations: [], capabilities: { inputs: { prompt: {} } } }];
const model = { id: SKILL_MODEL, name: 'Skill model', gated: false, credits_per_reply: 7 };
const control = (label: string) => root.container.queryAll(n => n.props.accessibilityLabel === label)[0];
const press = async (label: string) => { await act(async () => control(label).props.onClick({ nativeEvent: {} })); };
const textPresent = (text: string) => root.container.queryAll(n => n.children.includes(text)).length > 0;
const body = (id: string) => { const s = skillById(id)!; return `${s.name}. ${s.blurb}`; };
const checkbox = (id: string) => t('skillsUi.selectSkill', { name: skillById(id)!.name });
const select = async (...ids: string[]) => { for (const id of ids) await press(checkbox(id)); };
const render = async () => { await act(async () => root.render(<StudioSkills />)); };
const prompt = () => mockChat.updateThread.mock.calls[0][1].system_prompt;
beforeEach(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    jest.clearAllMocks(); mockParams = {}; mockReduced = false; mockDimensions = { width: 402, height: 874, scale: 3, fontScale: 1 }; root = createRoot();
    mockChat.listModels.mockReset().mockResolvedValue([model]);
    mockChat.createThread.mockReset().mockResolvedValue({ id: 'thread' });
    mockChat.updateThread.mockReset().mockResolvedValue({}); mockChat.deleteThread.mockReset().mockResolvedValue({});
    mockCatalog.mockReset().mockResolvedValue(catalog); mockCopy.mockReset().mockResolvedValue(true);
});
afterEach(async () => { await act(async () => root.unmount()); jest.useRealTimers(); });

test('groups, icon cards and Film Studio link; body only opens details', async () => {
    await render();
    for (const group of SKILL_GROUPS) expect(root.container.queryAll(n => n.props.accessibilityRole === 'header' && n.children.includes(t(`chat.skills.group.${group}`))).length).toBeGreaterThan(0);
    expect(textPresent(t('chat.skills.filmNote'))).toBe(false);
    for (const skill of SKILLS) {
        expect(control(body(skill.id))).toBeDefined();
        expect(control(body(skill.id)).queryAll(n => n.props.testID === `icon:${skillIcon(skill.id, skill.group).icon}`)).toHaveLength(1);
    }
    await press(t('chat.openFilmStudio')); expect(mockRouter.push).toHaveBeenCalledWith('/film');
    expect(control(t('chatDepth.startSkills'))).toBeUndefined();
    await press(body('prompt-writer'));
    expect(control(t('skillsUi.use'))).toBeDefined(); expect(mockChat.createThread).not.toHaveBeenCalled();
    expect(control(t('chatDepth.startSkills'))).toBeUndefined();
    expect(control(checkbox('prompt-writer')).props.accessibilityState.checked).toBe(false);
});
test('selection limit disables only unchosen checkboxes and sheet Add until one is removed', async () => {
    await render();
    const ids = ['prompt-writer', 'storyboard', 'add-sound', 'film-setup'];
    await select(...ids);
    expect(textPresent(t('chatDepth.selected', { count: 4, max: 4 }))).toBe(true);
    for (const skill of SKILLS) expect(control(checkbox(skill.id)).props.accessibilityState).toMatchObject({ checked: ids.includes(skill.id), disabled: !ids.includes(skill.id) });
    await press(checkbox('model-picker')); expect(control(checkbox('model-picker')).props.accessibilityState.checked).toBe(false);
    await press(body('model-picker')); expect(control(t('skillsUi.addToSelection')).props.accessibilityState.disabled).toBe(true);
    expect(textPresent(t('skillsUi.limit', { max: 4 }))).toBe(true);
    await press(t('skillsUi.addToSelection')); expect(control(checkbox('model-picker')).props.accessibilityState.checked).toBe(false);
    await press(t('common.close')); await select('prompt-writer');
    expect(control(checkbox('model-picker')).props.accessibilityState.disabled).toBe(false);
});
test('details add/remove keeps pick order and leaves sheet open', async () => {
    await render(); await select('prompt-writer', 'storyboard'); await press(body('add-sound'));
    await press(t('skillsUi.addToSelection')); expect(control(t('skillsUi.removeFromSelection'))).toBeDefined();
    await press(t('common.close')); await press(body('prompt-writer')); await press(t('skillsUi.removeFromSelection'));
    expect(control(t('skillsUi.addToSelection'))).toBeDefined(); await press(t('common.close')); await press(t('chatDepth.startSkills'));
    const picks = ['storyboard', 'add-sound'].map(id => skillById(id)!);
    expect(prompt()).toBe(skillsInstructions(picks, catalog));
    expect(mockRouter.replace).toHaveBeenCalledWith({ pathname: '/chat/[id]', params: { id: 'thread', starter: picks[0].starter } });
});
test('Start chat sends exactly one ordered set, with the first-picked starter', async () => {
    await render(); const ids = ['add-sound', 'prompt-writer', 'storyboard']; await select(...ids); await press(t('chatDepth.startSkills'));
    expect(mockChat.createThread).toHaveBeenCalledTimes(1); expect(mockChat.createThread).toHaveBeenCalledWith(SKILL_MODEL);
    expect(mockChat.updateThread).toHaveBeenCalledWith('thread', { system_prompt: skillsInstructions(ids.map(id => skillById(id)!), catalog) });
    expect(selectedSkillIds(prompt())).toEqual(ids);
    expect(mockRouter.replace).toHaveBeenCalledWith({ pathname: '/chat/[id]', params: { id: 'thread', starter: skillById(ids[0])!.starter } });
});
test('Use this skill ignores and preserves two page selections', async () => {
    await render(); await select('prompt-writer', 'storyboard'); await press(body('add-sound')); await press(t('skillsUi.use'));
    expect(selectedSkillIds(prompt())).toEqual(['add-sound']);
    for (const id of ['prompt-writer', 'storyboard']) expect(control(checkbox(id)).props.accessibilityState.checked).toBe(true);
    expect(control(checkbox('add-sound')).props.accessibilityState.checked).toBe(false);
});
test('workflow starts its own steps and preserves page selection', async () => {
    await render(); await select('model-picker', 'fix-my-prompt'); const workflow = workflowById('viral-short')!;
    await press(`${t('chatDepth.wfView')}: ${workflow.name}`); await press(t('chatDepth.wfStart'));
    expect(prompt()).toBe(skillsInstructions(workflowSteps(workflow), catalog));
    expect(control(checkbox('model-picker')).props.accessibilityState.checked).toBe(true);
    expect(control(checkbox('fix-my-prompt')).props.accessibilityState.checked).toBe(true);
});
test('ordinary continuity plus storyboard never becomes a locked hand-off', async () => {
    await render(); await select('oddling-continuity', 'storyboard'); await press(t('chatDepth.startSkills'));
    expect(parseOddlingInstructions(prompt())).toBeNull(); expect(selectedSkillIds(prompt())).toEqual(['oddling-continuity', 'storyboard']);
});
test.each([false, true])('failed PATCH cleans up best-effort (delete fails: %s)', async deleteFails => {
    mockChat.updateThread.mockRejectedValue(Error('patch'));
    if (deleteFails) mockChat.deleteThread.mockRejectedValue(Error('delete'));
    await render(); await select('prompt-writer'); await press(t('chatDepth.startSkills'));
    expect(mockChat.deleteThread).toHaveBeenCalledWith('thread'); expect(textPresent(t('chat.skills.failed'))).toBe(true);
    expect(mockRouter.replace).not.toHaveBeenCalled();
});
test('rejected catalog creates no thread', async () => {
    mockCatalog.mockRejectedValue(Error('offline')); await render(); await select('prompt-writer'); await press(t('chatDepth.startSkills'));
    expect(mockChat.createThread).not.toHaveBeenCalled(); expect(textPresent(t('chat.skills.failed'))).toBe(true);
});
test('too-long set is refused before creating a thread', async () => {
    mockCatalog.mockResolvedValue([{ ...catalog[0], id: 'x'.repeat(5000) }]);
    await render(); await select('prompt-writer'); await press(t('chatDepth.startSkills'));
    expect(mockChat.createThread).not.toHaveBeenCalled(); expect(textPresent(t('chatDepth.skillsTooLong'))).toBe(true);
});
test('copy link announces success for two seconds and price is the listed model price', async () => {
    jest.useFakeTimers(); await render(); await press(body('prompt-writer')); await press(t('skillsUi.copyLink'));
    expect(mockCopy).toHaveBeenCalledWith(`${API_BASE}/app/skills?skill=prompt-writer`);
    expect(control(t('skillsUi.copied'))).toBeDefined();
    expect(textPresent(plural('chat.creditsPerReply', 7))).toBe(true);
    await act(async () => jest.advanceTimersByTime(2000)); expect(control(t('skillsUi.copyLink'))).toBeDefined();
});
test('copy failure shares the same link', async () => {
    const share = jest.spyOn(RN.Share, 'share').mockResolvedValue({ action: RN.Share.sharedAction, activityType: undefined }); mockCopy.mockResolvedValue(false);
    try { await render(); await press(body('prompt-writer')); await press(t('skillsUi.copyLink'));
        expect(share).toHaveBeenCalledWith({ message: `${API_BASE}/app/skills?skill=prompt-writer` });
    } finally { share.mockRestore(); }
});
test.each([{ skill: 'fix-my-prompt' }, { skill: 'nope' }, { skill: ['a', 'b'] }, { workflow: 'product-ad' }])('deep link %j opens only known scalar details', async params => {
    mockParams = params; await render();
    expect(control(t('chatDepth.startSkills'))).toBeUndefined(); expect(mockChat.createThread).not.toHaveBeenCalled();
    expect(!!control(t('skillsUi.use'))).toBe(params.skill === 'fix-my-prompt');
    expect(!!control(t('chatDepth.wfStart'))).toBe(params.workflow === 'product-ad');
    if (params.skill === 'fix-my-prompt') { expect(textPresent(skillById('fix-my-prompt')!.starter)).toBe(true); await press(t('common.close')); await render(); expect(control(t('skillsUi.use'))).toBeUndefined(); }
});
test('model failure shows a quiet error, disables selection and hides the price note', async () => {
    mockChat.listModels.mockRejectedValue(Error('models')); mockParams = { skill: 'prompt-writer' }; await render();
    expect(textPresent(t('chat.skills.failed'))).toBe(true); expect(textPresent(t('skillsUi.generationSeparate'))).toBe(false);
    expect(control(checkbox('prompt-writer')).props.accessibilityState.disabled).toBe(true);
    expect(control(t('skillsUi.use')).props.accessibilityState.disabled).toBe(true);
});
test('card controls are siblings; reduced motion and every film workflow step icon are retained', async () => {
    mockReduced = true; mockParams = { skill: 'prompt-writer' }; await render();
    const bodyButton = control(body('prompt-writer')), checkButton = control(checkbox('prompt-writer'));
    expect(bodyButton.parent).toBe(checkButton.parent);
    expect(bodyButton.queryAll(n => n.props.accessibilityRole === 'checkbox')).toHaveLength(0);
    expect(root.container.queryAll(n => n.props.presentationStyle === 'pageSheet' && n.props.visible)[0].props.animationType).toBe('none');
    const workflow = workflowById('consistent-film')!;
    const workflowCard = control(`${t('chatDepth.wfView')}: ${workflow.name}`);
    expect(workflowCard).toBeDefined();
    await press(t('common.close')); await press(`${t('chatDepth.wfView')}: ${workflow.name}`);
    expect(workflowCard.queryAll(n => n.props.importantForAccessibility === 'no-hide-descendants')).toHaveLength(8);
    expect(MAX_SELECTED_SKILLS).toBe(4);
});
test('largest app and system text sizes use a single column in both themes', async () => {
    mockDimensions = { ...mockDimensions, fontScale: 3 };
    for (const theme of ['light', 'dark'] as const) {
        await act(async () => root.render(<AppearanceContext value={{ ...DEFAULT_APPEARANCE, theme, textSize: 'xl' }}><StudioSkills /></AppearanceContext>));
        for (const skill of SKILLS) expect(RN.StyleSheet.flatten(control(body(skill.id)).parent!.parent!.props.style).width).toBe('100%');
    }
});
