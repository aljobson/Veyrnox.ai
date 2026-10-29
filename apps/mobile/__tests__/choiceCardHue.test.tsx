import { act } from 'react';
import { StyleSheet } from 'react-native';
import { createRoot, type Root } from 'test-renderer';
import { ChoiceCard } from '../src/components/ui/ChoiceCard';
import { featureHue } from '../src/theme';
let root: Root;
beforeEach(() => { (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true; root = createRoot(); });
afterEach(async () => { await act(async () => root.unmount()); });
const flat = (style: unknown) => StyleSheet.flatten(style as any) ?? {};
const styled = () => root.container.queryAll(n => !!n.props.style).map(n => flat(n.props.style));
test('a hue tints the card and its icon circle with the feature colour', async () => {
    await act(async () => root.render(<ChoiceCard icon="camera" hue="sky" title="My photo" onPress={() => {}} />));
    const { wash, edge } = featureHue('sky', 'light');
    expect(styled().some(s => s.backgroundColor === wash && s.borderColor === edge && s.minHeight === 144)).toBe(true);
    expect(styled().some(s => s.backgroundColor === wash && s.width === 44)).toBe(true);
});
test('without a hue the card keeps its neutral look', async () => {
    await act(async () => root.render(<ChoiceCard icon="camera" title="My photo" onPress={() => {}} />));
    const { wash } = featureHue('sky', 'light');
    expect(styled().some(s => s.backgroundColor === wash)).toBe(false);
});
