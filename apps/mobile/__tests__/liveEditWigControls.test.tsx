import { act } from 'react';
import { createRoot } from 'test-renderer';
import { EffectControls } from '../src/components/liveEdit/EffectControls';
import { normalizeStack } from '../src/lib/liveEdit/engine';
import { t } from '../src/lib/i18n';

// Inspection S5B-001: the hair strength and first shade also tint a selected wig, which needs no hair mask.
async function render(stack: ReturnType<typeof normalizeStack>, { face, hair }: { face: boolean; hair: boolean }) {
    const root = createRoot();
    await act(async () => root.render(<EffectControls value={stack} onChange={() => {}} onChangeStart={() => {}} onChangeEnd={() => {}} face={face} hair={hair} disabled={false} wigState="ready" />));
    // Only nodes that carry an accessibility state count: a button's inner text node has the same label but no state.
    const byLabel = (label: string) => root.container.queryAll(n => (n.props.accessibilityLabel === label || n.props.label === label) && n.props.accessibilityState !== undefined);
    const disabledOf = (label: string) => { const nodes = byLabel(label); expect(nodes.length).toBeGreaterThan(0); return nodes.every(n => n.props.accessibilityState.disabled === true); };
    return { root, disabledOf, byLabel };
}
const withWig = (style: string) => normalizeStack({ wig: { style, strength: 1 } as never });

// Labels repeat (the makeup rows have their own "Shade 1" and eyeshadow has a "Second shade 1"); the hair rows come last on the screen.
const last = (nodes: { props: Record<string, unknown> }[]) => { expect(nodes.length).toBeGreaterThan(0); return (nodes[nodes.length - 1].props.accessibilityState as { disabled: boolean }).disabled; };

test('with a wig and one face, the tint controls work even when no hair mask was found', async () => {
    const { root, disabledOf, byLabel } = await render(withWig('bob'), { face: true, hair: false });
    expect(disabledOf(t('liveEdit.hair'))).toBe(false); // hair strength = wig tint strength
    expect(last(byLabel(t('liveEdit.shade', { n: '1' })))).toBe(false); // hair first shade = wig tint shade
    // Hair-only controls stay locked without a mask: the hair second shade and the modes.
    expect(last(byLabel(t('liveEdit.secondShade', { n: '1' })))).toBe(true);
    for (const label of [t('liveEdit.ombre'), t('liveEdit.highlights')]) expect(disabledOf(label)).toBe(true);
    await act(async () => root.unmount());
});

test('without a wig, or without a face, the tint controls stay locked until a hair mask exists', async () => {
    for (const [stack, face, hair, locked] of [[withWig('none'), true, false, true], [withWig('bob'), false, false, true], [withWig('none'), true, true, false]] as const) {
        const { root, disabledOf, byLabel } = await render(stack, { face, hair });
        expect(disabledOf(t('liveEdit.hair'))).toBe(locked);
        expect(last(byLabel(t('liveEdit.shade', { n: '1' })))).toBe(locked);
        await act(async () => root.unmount());
    }
});
