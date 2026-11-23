import { act } from 'react';
import { createRoot, type Root } from 'test-renderer';
import { NativeMotionProcessingSection } from '../src/components/editor/tools/NativeMotionProcessingSection';
import type { EditorMotionProcessingActions } from '../src/components/editor/tools/useEditorMotionProcessing';
import { t } from '../src/lib/i18n';
import { rawText } from '../src/lib/i18n/translate';

let root: Root;
beforeEach(() => { (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true; root = createRoot(); });
afterEach(async () => { await act(async () => root.unmount()); });

const actions = (sourceAvailable: boolean): EditorMotionProcessingActions => ({
    tools: ['stabilize'], checking: false, progress: null, error: null, done: false, sourceAvailable, run: jest.fn(), cancel: jest.fn(),
});

test('rendered motion action stays disabled for image or unowned sources and enables for a local video', async () => {
    await act(async () => root.render(<NativeMotionProcessingSection actions={actions(false)} />));
    const label = rawText(t('editorNativeMotion.stabilize'));
    let button = root.container.queryAll(node => node.props.accessibilityLabel === label)[0];
    expect(button.props.accessibilityState.disabled).toBe(true);
    await act(async () => root.render(<NativeMotionProcessingSection actions={actions(true)} />));
    button = root.container.queryAll(node => node.props.accessibilityLabel === label)[0];
    expect(button.props.accessibilityState.disabled).toBe(false);
});
