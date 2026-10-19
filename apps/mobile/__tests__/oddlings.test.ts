import en from '../src/lib/i18n/messages/en';
import { KIND_FILTERS, ODDLINGS, ODDLING_TABS, findOddling, inTab, kindCount, portraitUrl, reconcileKind, toggleKind, visibleOddlings } from '../src/lib/oddlings';

declare const require: (id: string) => any;
declare const __dirname: string;
const { spawnSync } = require('child_process') as { spawnSync: (cmd: string, args: string[], opts: object) => { status: number | null; stderr: string } };
const { readFileSync } = require('fs') as { readFileSync: (path: string, encoding: 'utf8') => string };
const { join } = require('path') as { join: (...p: string[]) => string };

describe('the cast', () => {
    test('is the web gallery: 72 characters, 68 human and 4 other beings', () => {
        expect(ODDLINGS).toHaveLength(72);
        expect(kindCount('all', 'human')).toBe(68);
        expect(kindCount('all', 'creature')).toBe(4);
        expect(new Set(ODDLINGS.map((o) => o.id)).size).toBe(72);
    });

    test('every collection tab has characters and All is first', () => {
        expect(ODDLING_TABS[0]).toEqual({ id: 'all', label: 'All characters' });
        for (const tab of ODDLING_TABS) expect(inTab(tab.id).length).toBeGreaterThan(0);
    });

    test('every character has a premise and canon to show', () => {
        for (const o of ODDLINGS) {
            expect(o.name && o.hook && o.accent).toBeTruthy();
            expect(o.identity.length).toBeGreaterThan(0);
            expect(o.traits.length).toBeGreaterThan(0);
        }
    });

    test('drift: cast.json matches what the web files produce today', () => {
        const run = spawnSync(process.execPath, [join(__dirname, '..', 'scripts', 'sync-oddlings-cast.mjs'), '--check'], { encoding: 'utf8', env: { ...process.env, NODE_NO_WARNINGS: '1' } });
        expect(run.stderr).toBe('');
        expect(run.status).toBe(0);
    });
});

describe('filters', () => {
    test('a kind filter narrows the open collection', () => {
        expect(visibleOddlings('all', 'creature')).toHaveLength(4);
        expect(visibleOddlings('all', null)).toHaveLength(72);
    });

    test('pressing the active chip clears it', () => {
        expect(toggleKind(null, 'human')).toBe('human');
        expect(toggleKind('human', 'human')).toBeNull();
        expect(toggleKind('human', 'creature')).toBe('creature');
    });

    test('a filter that would empty a new collection is dropped', () => {
        const noBeings = ODDLING_TABS.find((tab) => kindCount(tab.id, 'creature') === 0);
        expect(noBeings).toBeDefined();
        expect(reconcileKind(noBeings!.id, 'creature')).toBeNull();
        expect(reconcileKind('all', 'creature')).toBe('creature');
    });
});

describe('lookups and images', () => {
    test('only an id in the cast opens a sheet', () => {
        expect(findOddling('duchess-volume')?.name).toBe('Duchess Volume');
        for (const bad of [undefined, '', '../etc', 'Duchess-Volume', 'toString', 'x'.repeat(80)]) expect(findOddling(bad)).toBeNull();
    });

    test('portraits are remote public images, never bundled', () => {
        expect(portraitUrl('duchess-volume')).toBe('https://veyrnox.ai/oddlings/portraits/duchess-volume.webp');
    });
});

describe('strings', () => {
    test.each(['src/app/(app)/oddlings/index.tsx', 'src/app/(app)/oddlings/[id].tsx', 'src/components/oddlings/OddlingFilters.tsx'])('%s asks only for keys that exist', (file) => {
        const text = readFileSync(join(__dirname, '..', file), 'utf8');
        const catalog = en as Record<string, string>;
        for (const m of text.matchAll(/\b(t|plural)\(\s*'([A-Za-z0-9_.]+)'/g)) expect(m[1] === 'plural' ? `${m[2]}.other` in catalog : m[2] in catalog).toBe(true);
    });

    test('kind filter labels exist', () => {
        for (const f of KIND_FILTERS) expect(f.labelKey in (en as Record<string, string>)).toBe(true);
    });
});
