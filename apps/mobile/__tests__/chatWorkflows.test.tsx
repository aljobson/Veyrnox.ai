import { act } from 'react';
import * as RN from 'react-native';
import { createRoot, type Root } from 'test-renderer';
import StudioSkills from '../src/app/(app)/chat/skills';
import { STUDIO_WORKFLOWS, workflowById, workflowSteps } from '../src/lib/studioWorkflows';
import { selectedSkillIds } from '../src/lib/studioSkills';
import { t } from '../src/lib/i18n';
const mockRouter = { push: jest.fn(), replace: jest.fn() }, mockApi = {};
const mockCreate = jest.fn(), mockUpdate = jest.fn();
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ bottom: 0 }) }));
jest.mock('expo-router', () => ({ Stack: { Screen: () => null }, useRouter: () => mockRouter, useLocalSearchParams: () => mockParams }));
jest.mock('../src/auth/AuthProvider', () => ({ useAuth: () => ({ api: mockApi }) }));
jest.mock('../src/lib/chat', () => ({ ...jest.requireActual('../src/lib/chat'), chatApi: () => ({ listModels: async () => [{ id: 'm', gated: false }], createThread: mockCreate, updateThread: mockUpdate }) }));
jest.mock('../src/lib/media', () => ({ ...jest.requireActual('../src/lib/media'), fetchCatalog: async () => [] }));
void [RN.View, RN.Text, RN.Pressable, RN.ScrollView, RN.Modal];
let mockParams = {};
let root: Root;
const control = (label: string) => root.container.queryAll(n => n.props.accessibilityLabel === label)[0];
const press = async (label: string) => { await act(async () => control(label).props.onClick({ nativeEvent: {} })); };
beforeEach(async () => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true; jest.clearAllMocks(); mockParams = {}; root = createRoot();
    mockCreate.mockResolvedValue({ id: 'thread' }); mockUpdate.mockResolvedValue({}); await act(async () => root.render(<StudioSkills />));
});
afterEach(async () => { await act(async () => root.unmount()); });
test.each(['viral-short', 'consistent-film', 'oddling-series'])('Start workflow %s', async id => {
    const workflow = workflowById(id)!; await press(`${t('chatDepth.wfView')}: ${workflow.name}`); await press(t('chatDepth.wfStart'));
    if (workflow.href) { expect(mockRouter.push).toHaveBeenCalledWith(workflow.href); expect(mockCreate).not.toHaveBeenCalled(); }
    else {
        expect(mockCreate).toHaveBeenCalledTimes(1); const prompt = mockUpdate.mock.calls[0][1].system_prompt;
        const steps = workflowSteps(workflow); steps.forEach(step => expect(prompt).toContain(step.body));
        expect(selectedSkillIds(prompt)).toEqual(steps.map(s => s.id));
        expect(mockRouter.replace).toHaveBeenCalledWith({ pathname: '/chat/[id]', params: { id: 'thread', starter: steps[0].starter } });
    }
});
test('step Open starts exactly one skill and all five workflows exist', async () => {
    expect(STUDIO_WORKFLOWS).toHaveLength(5); const workflow = workflowById('viral-short')!, skill = workflowSteps(workflow)[1];
    await press(`${t('chatDepth.wfView')}: ${workflow.name}`); await press(`${t('chatDepth.wfOpen')}: ${skill.name}`);
    expect(mockCreate).toHaveBeenCalledTimes(1); expect(selectedSkillIds(mockUpdate.mock.calls[0][1].system_prompt)).toEqual([skill.id]);
});

test('Oddling series shows every step and starts in Oddling Studio', async () => {
    const workflow = workflowById('oddling-series')!;
    await press(`${t('chatDepth.wfView')}: ${workflow.name}`);
    expect(workflowSteps(workflow)).toHaveLength(4);
    for (const step of workflowSteps(workflow)) expect(control(`${t('chatDepth.wfOpen')}: ${step.name}`)).toBeDefined();
    await press(t('chatDepth.wfStart'));
    expect(mockRouter.push).toHaveBeenCalledWith('/oddlings');
});
