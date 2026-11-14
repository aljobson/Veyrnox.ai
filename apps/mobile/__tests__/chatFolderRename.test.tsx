import { act, type ReactElement } from 'react';
import * as RN from 'react-native';
import { createRoot, type Root } from 'test-renderer';
import { AppearanceContext } from '../src/components/ui';
import Folders from '../src/app/(app)/chat/folders';
import { DEFAULT_APPEARANCE } from '../src/theme';

const mockApi = {};
const mockRename = jest.fn();
let mockFolders = [{ id: 'f1', name: 'QA', count: 0 }];
jest.mock('expo-router', () => ({ Stack: { Screen: () => null } }));
jest.mock('../src/auth/AuthProvider', () => ({ useAuth: () => ({ api: mockApi }) }));
jest.mock('../src/lib/chatLibrary', () => ({ ...jest.requireActual('../src/lib/chatLibrary'),
    fetchFolders: async () => mockFolders,
    renameFolder: (...a: unknown[]) => mockRename(...a),
}));
void [RN.View, RN.Text, RN.TextInput, RN.Pressable, RN.ActivityIndicator];
let root: Root;
const event = { nativeEvent: {}, currentTarget: 1, target: 1, persist: jest.fn() };
const all = (label: string) => root.container.queryAll(n => n.props.accessibilityLabel === label);
async function render(el: ReactElement) {
    await act(async () => root.render(<AppearanceContext.Provider value={DEFAULT_APPEARANCE}>{el}</AppearanceContext.Provider>));
}
beforeEach(() => { (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true; root = createRoot(); jest.clearAllMocks(); mockFolders = [{ id: 'f1', name: 'QA', count: 0 }]; });
afterEach(async () => { await act(async () => root.unmount()); });

test('renaming sends the new name and the list shows it', async () => {
    mockRename.mockImplementation(async (_a: unknown, id: string, name: string) => { mockFolders = [{ id, name, count: 0 }]; });
    await render(<Folders />);
    await act(async () => all('Rename QA')[0].props.onClick(event));
    await act(async () => all('New folder name')[0].props.onChangeText('QA2'));
    await act(async () => all('Rename')[0].props.onClick(event));
    expect(mockRename).toHaveBeenCalledWith(mockApi, 'f1', 'QA2');
    expect(root.container.queryAll(n => n.props.children === 'QA2').length).toBeGreaterThan(0);
});

test('a refused rename shows a clear message and keeps editing', async () => {
    mockRename.mockRejectedValue(Object.assign(new Error('x'), { status: 409, code: 'folder_exists' }));
    await render(<Folders />);
    await act(async () => all('Rename QA')[0].props.onClick(event));
    await act(async () => all('New folder name')[0].props.onChangeText('Dup'));
    await act(async () => all('Rename')[0].props.onClick(event));
    expect(root.container.queryAll(n => n.props.children === 'You already have a folder with that name.').length).toBeGreaterThan(0);
    expect(all('New folder name')[0].props.value).toBe('Dup');
});

test('renaming to the same name sends nothing', async () => {
    await render(<Folders />);
    await act(async () => all('Rename QA')[0].props.onClick(event));
    await act(async () => all('Rename')[0].props.onClick(event));
    expect(mockRename).not.toHaveBeenCalled();
});
