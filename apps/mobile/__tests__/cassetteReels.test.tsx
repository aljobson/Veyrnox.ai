import { act } from 'react';
import { createRoot } from 'test-renderer';
import { CassetteReels } from '../src/components/CassetteReels';

test('the cassette gives screen readers nothing to land on, playing or not', async () => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    const root = createRoot();
    for (const playing of [false, true]) {
        await act(async () => root.render(<CassetteReels playing={playing} />));
        const reachable = root.container.queryAll(node => node.props.accessible === true || typeof node.props.accessibilityLabel === 'string' || typeof node.props.accessibilityRole === 'string');
        expect(reachable).toHaveLength(0);
    }
    await act(async () => root.unmount());
});
