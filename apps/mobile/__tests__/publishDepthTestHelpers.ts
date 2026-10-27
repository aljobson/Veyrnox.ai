import { act } from 'react';
import type { Root, TestInstance } from 'test-renderer';
export const ID = '11111111-1111-4111-8111-111111111111';
export const OTHER = '22222222-2222-4222-8222-222222222222';
export const textOf = (node: TestInstance): string => node.children.map(c => typeof c === 'string' ? c : textOf(c)).join(' ');
export function buttons(root: Root, label: string) { return root.container.queryAll(n => n.props.accessibilityRole === 'button' && (textOf(n) === label || n.props.accessibilityLabel === label)); }
export async function press(root: Root, label: string) {
    const matches = buttons(root, label); expect(matches).toHaveLength(1);
    await act(async () => { matches[0].props.onClick({ nativeEvent: {}, currentTarget: 1, target: 1 }); });
}
export function field(root: Root, label: string) {
    const nodes = root.container.queryAll(n => n.props.accessibilityLabel === label && typeof n.props.onChangeText === 'function');
    expect(nodes).toHaveLength(1); return nodes[0];
}
export async function input(root: Root, label: string, value: string) { await act(async () => field(root, label).props.onChangeText(value)); }
export function deferred<T>() {
    let resolve!: (value: T) => void, reject!: (error: unknown) => void;
    const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
    return { promise, resolve, reject };
}
