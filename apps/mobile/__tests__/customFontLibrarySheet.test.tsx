import { act } from 'react';
import { Alert } from 'react-native';
import { createRoot, type Root, type TestNode } from 'test-renderer';
import { CustomFontLibrarySheet } from '../src/components/editor/fonts/CustomFontLibrarySheet';
import type { EditorFontActions } from '../src/components/editor/useEditorFonts';
import { rawText, t } from '../src/lib/i18n';
import type { CustomFont } from '../src/lib/nativeEditorModel';

const family = `VXFont_${'a'.repeat(64)}`;
const font: CustomFont = {
    family,
    name: 'Studio Serif',
    sourceName: 'studio-serif.ttf',
    sha256: 'a'.repeat(64),
    bytes: 1024,
    format: 'ttf',
    rights: { credit: 'Studio Type', usage: 'Licensed for this project', url: 'https://example.test/licence' },
};

const makeActions = (patch: Partial<EditorFontActions> = {}) => ({
    available: true,
    busy: null,
    problem: null,
    clearProblem: jest.fn(),
    has: jest.fn(() => true),
    failed: jest.fn(() => false),
    add: jest.fn(async () => false),
    relink: jest.fn(async () => false),
    remove: jest.fn(async () => true),
    ...patch,
}) as EditorFontActions;

let root: Root;
beforeEach(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    jest.clearAllMocks();
    jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    root = createRoot();
});
afterEach(async () => {
    await act(async () => root.unmount());
    jest.restoreAllMocks();
});

async function render(actions: EditorFontActions, options: { selected?: string; onClose?: jest.Mock } = {}) {
    const onClose = options.onClose ?? jest.fn();
    await act(async () => root.render(<CustomFontLibrarySheet visible fonts={[font]} actions={actions} used={{ [family]: 0 }}
        selected={options.selected} onUse={jest.fn()} onClose={onClose} />));
    return onClose;
}

function button(label: string) {
    return root.container.queryAll(node => node.props.accessibilityLabel === rawText(label) && typeof node.props.onClick === 'function')[0];
}

function textContent(node: TestNode): string {
    return typeof node === 'string' ? node : node.children.map(textContent).join('');
}

async function press(label: string) {
    const node = button(label);
    expect(node).toBeDefined();
    await act(async () => node.props.onClick({ nativeEvent: {} }));
}

test('renders a modal-local problem as an alert', async () => {
    const problem = 'Choose the original font file.';
    await render(makeActions({ problem }));

    const alerts = root.container.queryAll(node => node.props.accessibilityRole === 'alert');
    expect(alerts).toHaveLength(1);
    expect(alerts[0].children).toContain(problem);
});

test('shows the selected font as visibly in use and exposes its selected state', async () => {
    await render(makeActions(), { selected: family });

    expect(root.container.queryAll(node => textContent(node) === `✓ ${t('editorFont.inUse')}`, { matchDeepestOnly: true })).toHaveLength(1);
    const selectedName = root.container.queryAll(node => node.children.includes(font.name) && node.props.accessibilityState?.selected === true);
    expect(selectedName).toHaveLength(1);
});

test('distinguishes an unsupported local face from a missing file', async () => {
    await render(makeActions({ has: jest.fn(() => false), failed: jest.fn(() => true) }));
    expect(root.container.queryAll(node => node.children.includes(t('editorFont.unsupportedOnIphone')))).toHaveLength(1);
    expect(root.container.queryAll(node => node.children.includes(t('editorFont.relinkNeeded')))).toHaveLength(0);
});

test('prevents Close while checking and announces the checking state politely', async () => {
    const onClose = jest.fn();
    await render(makeActions(), { onClose });
    await press(t('editorFont.add'));
    await render(makeActions({ busy: 'new' }), { onClose });

    expect(button(t('editorFont.close')).props.accessibilityState?.disabled).toBe(true);
    const modal = root.container.queryAll(node => node.props.accessibilityViewIsModal === true)[0];
    expect(modal).toBeDefined();
    await act(async () => modal.props.onRequestClose());
    expect(onClose).not.toHaveBeenCalled();
    const checking = root.container.queryAll(node => node.props.accessibilityLiveRegion === 'polite' && node.children.includes(t('editorFont.checking')));
    expect(checking).toHaveLength(1);
});

test('requires destructive Alert confirmation before removing a font', async () => {
    const actions = makeActions();
    await render(actions);
    await press(t('editorFont.remove', { name: font.name }));

    expect(actions.remove).not.toHaveBeenCalled();
    expect(Alert.alert).toHaveBeenCalledTimes(1);
    const buttons = jest.mocked(Alert.alert).mock.calls[0][2]!;
    const destructive = buttons.find(item => item.style === 'destructive');
    expect(destructive).toEqual(expect.objectContaining({ text: rawText(t('editorFont.removeConfirm')), style: 'destructive' }));

    await act(async () => destructive!.onPress!());
    expect(actions.remove).toHaveBeenCalledTimes(1);
    expect(actions.remove).toHaveBeenCalledWith(font);
});
