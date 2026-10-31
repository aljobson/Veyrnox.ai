import { act } from 'react';
import { createRoot } from 'test-renderer';
import { ReceiptSlip } from '../src/components/ReceiptSlip';

test('the receipt reads as one unit with every row, and shows each value', async () => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    const root = createRoot();
    await act(async () => root.render(<ReceiptSlip title="Receipt" footer="Thank you for your purchase."
        rows={[{ label: 'Credits', value: '+500' }, { label: 'Paid', value: '£4.99' }, { label: 'New balance', value: '505' }]} />));
    const slip = root.container.queryAll(node => node.props.accessible === true && typeof node.props.accessibilityLabel === 'string')[0];
    expect(slip.props.accessibilityLabel).toBe('Receipt. Credits +500. Paid £4.99. New balance 505. Thank you for your purchase.');
    const texts = root.container.queryAll(node => typeof node.props.children === 'string').map(node => node.props.children);
    expect(texts).toEqual(expect.arrayContaining(['+500', '£4.99', '505']));
    await act(async () => root.unmount());
});
