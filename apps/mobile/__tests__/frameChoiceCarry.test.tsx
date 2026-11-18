import { act } from 'react';
import * as RN from 'react-native';
import { createRoot, type Root } from 'test-renderer';
import { useFrameChoice } from '../src/components/create/FrameChips';

void [RN.View, RN.Text, RN.Pressable];
let root: Root;
let seen: ReturnType<typeof useFrameChoice>;
function Probe({ modelId, handoff }: { readonly modelId?: string; readonly handoff?: string }) {
    seen = useFrameChoice(modelId, handoff);
    return <>{seen.node}</>;
}
beforeEach(() => { (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true; root = createRoot(); });
afterEach(async () => { await act(async () => root.unmount()); });

const press = async (label: string) => {
    const chip = root.container.queryAll(n => n.props.accessibilityLabel === label)[0]!;
    await act(async () => chip.props.onClick({ nativeEvent: {}, target: 1, currentTarget: 1 }));
};

// A model switch (Pro to Standard) opens Create again for the new model; the photo already uploaded is the cropped one,
// so the chip must still say the frame it was cropped to.
test('the frame chosen on one Kling model is still chosen on the screen a model switch opens', async () => {
    await act(async () => root.render(<Probe modelId="kling-3.0-i2v" />));
    await press('9:16');
    expect(seen.value).toBe('9:16');
    const href = { pathname: '/create/[modelId]', params: { modelId: 'kling-3.0-standard-i2v', sourceHandoff: 'handoff-1' } };
    expect(seen.carry(href)).toBe(href);

    await act(async () => root.unmount());
    root = createRoot();
    await act(async () => root.render(<Probe modelId="kling-3.0-standard-i2v" handoff="handoff-1" />));
    expect(seen.value).toBe('9:16');
});

test('another hand-off, no hand-off, and Original start from Original', async () => {
    await act(async () => root.render(<Probe modelId="kling-3.0-i2v" />));
    seen.carry({ params: { sourceHandoff: 'only-original' } });
    await act(async () => root.unmount());
    for (const handoff of ['only-original', 'unknown-key', undefined]) {
        root = createRoot();
        await act(async () => root.render(<Probe modelId="kling-3.0-i2v" handoff={handoff} />));
        expect(seen.value).toBe('');
        await act(async () => root.unmount());
    }
    root = createRoot();
});

test('a model with no frame choice shows none and carries nothing', async () => {
    await act(async () => root.render(<Probe modelId="wan-2.5-kie" />));
    expect(seen.value).toBe('');
    expect(seen.node).toBeNull();
    const href = { params: { sourceHandoff: 'k-other' } };
    expect(seen.carry(href)).toBe(href);
    await act(async () => root.unmount());
    root = createRoot();
    await act(async () => root.render(<Probe modelId="kling-3.0-i2v" handoff="k-other" />));
    expect(seen.value).toBe('');
});
