import { act } from 'react';
import * as RN from 'react-native';
import { createRoot, type Root } from 'test-renderer';
import { PickSheet } from '../src/components/oddlings/PickSheet';
import { FilmSelect } from '../src/components/film/FilmSelect';
import { t } from '../src/lib/i18n';
declare const __dirname: string;
void [RN.Modal, RN.FlatList, RN.Pressable, RN.StyleSheet];
let root: Root;
const has = (text: string) => root.container.queryAll(n => n.children.includes(text)).length > 0;
const buttons = () => root.container.queryAll(n => n.props.accessibilityRole === 'button');
const textOf = (node: any): string => node.children.map((c: any) => typeof c === 'string' ? c : textOf(c)).join('');
const click = async (label: string) => { const button = buttons().find(n => n.props.accessibilityLabel === label || textOf(n) === label)!;
    expect(button).toBeDefined(); await act(async () => button.props.onClick({ nativeEvent: {}, currentTarget: 1, target: 1 })); };
beforeEach(() => { (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true; root = createRoot(); });
afterEach(async () => { await act(async () => root.unmount()); });
test('default keeps Not set for both existing Oddlings callers', async () => {
    await act(async () => root.render(<PickSheet title="Traits" choices={[{ value: 'a', label: 'A' }]} value="a" onPick={() => {}} onClose={() => {}} />));
    expect(has(t('oddlings.build.notSet'))).toBe(true);
    const fs = require('fs'), path = require('path');
    for (const file of ['src/app/(app)/oddlings/build.tsx', 'src/components/CharacterPanel.tsx']) {
        const source = fs.readFileSync(path.resolve(__dirname, '..', file), 'utf8');
        expect(source).toMatch(/<PickSheet\s/); expect(source).not.toMatch(/noneLabel=/);
    }
});
test('null omits the empty row and picking calls onPick and onClose', async () => {
    const onPick = jest.fn(), onClose = jest.fn();
    await act(async () => root.render(<PickSheet title="Models" choices={[{ value: 'a', label: 'A' }]} value="" noneLabel={null} onPick={onPick} onClose={onClose} />));
    expect(has(t('oddlings.build.notSet'))).toBe(false);
    await click('A'); expect(onPick).toHaveBeenCalledWith('a'); expect(onClose).toHaveBeenCalledTimes(1);
});
test('FilmSelect announces field and current option and opens a 44pt picker without an empty row', async () => {
    const onChange = jest.fn();
    await act(async () => root.render(<FilmSelect label="Model" value="a" options={[{ value: 'a', label: 'Alpha' }, { value: 'b', label: 'Beta' }]} onChange={onChange} />));
    const button = buttons()[0];
    expect(RN.StyleSheet.flatten(button.props.style).minHeight).toBeGreaterThanOrEqual(44);
    await click('Model, Alpha'); expect(has(t('oddlings.build.notSet'))).toBe(false);
    await click('Beta'); expect(onChange).toHaveBeenCalledWith('b'); expect(has('Beta')).toBe(false);
});
