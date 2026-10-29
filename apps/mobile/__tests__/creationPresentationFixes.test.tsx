import { act } from 'react';
import * as RN from 'react-native';
import { createRoot, type Root } from 'test-renderer';
import ts from 'typescript';
import { Chip, TextField } from '../src/components/ui';
import { AppearanceContext } from '../src/components/ui/AppearanceContext';
import { CreateOptions } from '../src/components/CreateOptions';
import { LibraryItem } from '../src/components/LibraryItem';
import { VeyCardPeek } from '../src/components/VeyCardPeek';
import { SectionLabel } from '../src/components/create/SectionLabel';
import { DEFAULT_APPEARANCE, tokensForScheme, type ThemePreference } from '../src/theme';
import { MENU_ICONS } from '../src/lib/menuIcons';
import { t } from '../src/lib/i18n';

declare const require: (id: string) => any;
declare const __dirname: string;
const fs = require('fs');
const path = require('path');
void [RN.View, RN.Text, RN.TextInput, RN.Pressable, RN.Image];
let root: Root;
beforeEach(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    root = createRoot();
});
afterEach(async () => { await act(async () => root.unmount()); });
const control = (label: string) => root.container.queryAll(n => n.props.accessibilityLabel === label)[0];

test.each([
    ['components/CreateOptions.tsx', ['input', 'seed', 'negative']],
    ['app/(app)/create/[modelId].tsx', ['prompt']],
] as const)('%s leaves field borders and spacing to TextField', (file, styles) => {
    const source = fs.readFileSync(path.join(__dirname, '../src', file), 'utf8');
    const parsed = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const checked: string[] = [];
    function visit(node: ts.Node) {
        if (ts.isPropertyAssignment(node) && styles.some(name => name === node.name.getText(parsed)) && ts.isObjectLiteralExpression(node.initializer)) {
            checked.push(node.name.getText(parsed));
            for (const prop of node.initializer.properties) {
                expect(prop.name?.getText(parsed)).not.toMatch(/^(border|backgroundColor|padding)/);
            }
        }
        ts.forEachChild(node, visit);
    }
    visit(parsed);
    expect(checked.sort()).toEqual([...styles].sort());
});

test.each([true, false, 'Invalid seed'])('TextField error=%s styles its shell and preserves string messages', async error => {
    await act(async () => root.render(<TextField label="Seed" error={error} />));
    const p = tokensForScheme('light', DEFAULT_APPEARANCE);
    expect(RN.StyleSheet.flatten(control(typeof error === 'string' ? `Seed, ${error}` : 'Seed').props.style).borderWidth).toBeUndefined();
    const shells = root.container.queryAll(n => RN.StyleSheet.flatten(n.props.style)?.borderWidth === 1);
    expect(shells).toHaveLength(1);
    expect(RN.StyleSheet.flatten(shells[0].props.style).borderColor).toBe(error ? p.danger : p.borderStrong);
    expect(root.container.queryAll(n => n.props.accessibilityRole === 'alert')).toHaveLength(typeof error === 'string' ? 1 : 0);
});

test('invalid seed and audio length retain one help line each and a single field border', async () => {
    await act(async () => root.render(<CreateOptions
        options={{ seed: true, negativeMax: 100, aspects: [], voice: true, audioLength: { min: 1, max: 30, def: 10 }, resolutions: [], audioChoice: false }}
        values={{ aspect: null, count: 1, seed: 'bad', negative: '', voice: '', audioSeconds: '99' }}
        showCount={false} onChange={jest.fn()}
    />));
    for (const label of ['opt.seed', 'opt.audioLength', 'opt.voice', 'opt.exclude']) {
        const style = RN.StyleSheet.flatten(control(t(label)).props.style);
        expect(style.borderWidth).toBeUndefined();
        expect(style.backgroundColor).toBeUndefined();
    }
    expect(root.container.queryAll(n => n.props.accessibilityLiveRegion === 'polite')).toHaveLength(2);
    const danger = tokensForScheme('light', DEFAULT_APPEARANCE).danger;
    expect(root.container.queryAll(n => {
        const style = RN.StyleSheet.flatten(n.props.style);
        return style?.borderWidth === 1 && style?.borderColor === danger;
    })).toHaveLength(2);
});

test.each([false, true])('fullWidth=%s changes only the chip fill layout', async fullWidth => {
    await act(async () => root.render(<Chip fullWidth={fullWidth} style={{ flex: 1 }} label="Any price" onPress={jest.fn()} />));
    expect(RN.StyleSheet.flatten(control('Any price').props.style)).toMatchObject({ flex: 1, minHeight: 44 });
    expect(root.container.queryAll(n => RN.StyleSheet.flatten(n.props.style)?.alignSelf === (fullWidth ? 'stretch' : 'flex-start'))).toHaveLength(1);
});

test.each<ThemePreference>(['light', 'dark', 'oled'])('library dividers and fixed character art survive %s', async theme => {
    const settings = { ...DEFAULT_APPEARANCE, theme };
    const onStar = jest.fn();
    for (const grid of [false, true]) {
        for (const starred of [false, true]) {
            await act(async () => root.render(<AppearanceContext.Provider value={settings}>
                <LibraryItem job={{ job_id: 'job', model_id: 'model', state: 'succeeded', credits: 1, created_at: '2026-10-01', has_asset: true }}
                    retentionKnown now={Date.now()} name="Creation" kind="image" grid={grid} starred={starred} canSchedule={false} canReuse={false}
                    onOpen={jest.fn()} onStar={onStar} onSchedule={jest.fn()} onReuse={jest.fn()} />
                <VeyCardPeek />
            </AppearanceContext.Provider>));
            const star = control(t('library.favouriteLabel', { name: 'Creation' }));
            expect(star.props.accessibilityState.selected).toBe(starred);
            expect(RN.StyleSheet.flatten(star.props.style)).toMatchObject({ minWidth: 44, minHeight: 52 });
            expect(RN.StyleSheet.flatten(star.props.style).backgroundColor).toBeUndefined();
            expect(root.container.queryAll(n => n.props.source === MENU_ICONS[starred ? 'starFill' : 'star'])).toHaveLength(1);
            const rows = root.container.queryAll(n => RN.StyleSheet.flatten(n.props.style)?.borderBottomWidth === RN.StyleSheet.hairlineWidth);
            expect(rows).toHaveLength(1);
            if (!grid) expect(RN.StyleSheet.flatten(rows[0].props.style)).toMatchObject({ borderWidth: 0, borderRadius: 0, paddingHorizontal: 0, boxShadow: 'none' });
            else expect(RN.StyleSheet.flatten(rows[0].props.style).borderRadius).toBeGreaterThan(0);
            const paws = root.container.queryAll(n => RN.StyleSheet.flatten(n.props.style)?.backgroundColor === '#dbe8ea');
            expect(paws).toHaveLength(2);
            paws.forEach(paw => expect(RN.StyleSheet.flatten(paw.props.style).borderColor).toBe('#789b9f'));
            await act(async () => star.props.onClick({ nativeEvent: {}, currentTarget: 1, target: 1 }));
        }
    }
    expect(onStar).toHaveBeenCalledTimes(4);
});

test.each(['OpenAI · iPhone', 'İstanbul', 'Images', 'REFUND ON FAILURE · ALWAYS'])('section labels preserve translated casing: %s', async label => {
    await act(async () => root.render(<SectionLabel>{label}</SectionLabel>));
    expect(root.container.queryAll(n => n.children.includes(label))).toHaveLength(1);
});
