import { act } from 'react';
import * as RN from 'react-native';
import { createRoot, type Root } from 'test-renderer';
import { MakePanel } from '../src/components/chat/MakePanel';
import { ApiError } from '../src/lib/api';
import { plural, t } from '../src/lib/i18n';
const mockRouter = { push: jest.fn() }, mockApi = {}, mockCreate = jest.fn(), mockClose = jest.fn();
jest.mock('expo-router', () => ({ useRouter: () => mockRouter }));
jest.mock('expo-crypto', () => ({ randomUUID: () => '12345678-1234-1234-1234-123456789abc' }));
jest.mock('../src/auth/AuthProvider', () => ({ useAuth: () => ({ api: mockApi }) }));
jest.mock('../src/lib/media', () => ({
    ...jest.requireActual('../src/lib/media'),
    fetchCatalog: async () => [{ id: 'image', name: 'Image', modality: 'text-to-image', credits: 2, gated: false, durations: [], capabilities: { inputs: { prompt: { max: 2000 } }, media: {} } }],
    mediaApi: () => ({ createGeneration: mockCreate }),
}));
void [RN.View, RN.Text, RN.Pressable, RN.ScrollView, RN.Modal, RN.TextInput];
let root: Root;
const control = (label: string) => root.container.queryAll(n => n.props.accessibilityLabel === label)[0];
const press = async (label: string) => { await act(async () => control(label).props.onClick({ nativeEvent: {} })); };
beforeEach(async () => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true; jest.clearAllMocks(); mockCreate.mockReset(); root = createRoot();
    await act(async () => root.render(<MakePanel visible initialPrompt="A quiet lake" onClose={mockClose} />));
});
afterEach(async () => { await act(async () => root.unmount()); });
test.each(['insufficient_balance', 'insufficient_credits'])('Make refusal %s offers native top-up and preserves the prompt', async code => {
    expect(control(t('lowBalance.buy'))).toBeUndefined();
    mockCreate.mockRejectedValueOnce(new ApiError(402, code)); await press(plural('chat.make.buttonLabel', 2));
    expect(root.container.queryAll(n => n.children.includes(t('chat.make.err.credits')))).toHaveLength(1);
    await press(t('lowBalance.buy')); expect(mockClose).toHaveBeenCalledTimes(1); expect(mockRouter.push).toHaveBeenCalledWith('/credits');
    mockCreate.mockRejectedValueOnce(new ApiError(429, 'rate_limited')); await press(plural('chat.make.buttonLabel', 2));
    expect(root.container.queryAll(n => n.children.includes(t('chat.make.err.rate')))).toHaveLength(1);
    expect(control(t('lowBalance.buy'))).toBeUndefined();
    expect(mockCreate.mock.calls[1][0].prompt).toBe('A quiet lake');
});
