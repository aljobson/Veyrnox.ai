import { act } from 'react';
import { createRoot } from 'test-renderer';
import { CassetteReels } from '../src/components/CassetteReels';

test('the cassette is hidden from screen readers, playing or not', async () => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    const root = createRoot();
    for (const playing of [false, true]) {
        await act(async () => root.render(<CassetteReels playing={playing} />));
        const cassette = root.container.queryAll(node => node.props.testID === 'cassette-reels')[0];
        expect(cassette.props.accessibilityElementsHidden).toBe(true);
        expect(cassette.props.importantForAccessibility).toBe('no-hide-descendants');
    }
    await act(async () => root.unmount());
});
